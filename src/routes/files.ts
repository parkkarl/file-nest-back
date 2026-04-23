import { Hono } from 'hono';
import { and, desc, eq, count, sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../db/client.ts';
import { files, versions } from '../db/schema.ts';
import { requireAuth, type AuthVars } from '../lib/auth.ts';
import { badRequest, notFound, payloadTooLarge, problem } from '../lib/errors.ts';
import { toFileDto } from '../lib/dto.ts';
import { fileUrl } from '../lib/hateoas.ts';
import { readPagination, setPaginationHeaders } from '../lib/pagination.ts';
import { storeBlob, deleteBlob } from '../lib/storage.ts';
import { requireIfMatch } from '../lib/http.ts';
import { config } from '../config.ts';

const MAX_NAME_LEN = 255;
const MAX_DESCRIPTION_LEN = 2048;

const app = new Hono<{ Variables: AuthVars }>();
app.use('*', requireAuth);

function computeEtag(file: typeof files.$inferSelect) {
  return '"' + createHash('sha1').update(`${file.id}|${file.updatedAt}|${file.currentVersionId ?? ''}`).digest('hex') + '"';
}

function sanitizeName(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

async function getCurrentVersion(fileId: string, versionId: string | null) {
  if (!versionId) return null;
  return await db.select().from(versions).where(eq(versions.id, versionId)).get();
}

async function getVersionCount(fileId: string) {
  const row = await db.select({ n: count() }).from(versions).where(eq(versions.fileId, fileId)).get();
  return row?.n ?? 0;
}

app.get('/', async (c) => {
  const ownerId = c.get('userId');
  const p = readPagination(c);
  const nameFilter = c.req.query('name');
  const sort = c.req.query('sort') ?? '-updatedAt';

  // Escape SQL LIKE wildcards (%, _, \) in the user's query before wrapping.
  const escaped = nameFilter?.replace(/[\\%_]/g, (m) => `\\${m}`);
  const where = escaped
    ? and(eq(files.ownerId, ownerId), sql`${files.name} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`)
    : eq(files.ownerId, ownerId);

  const orderBy = (() => {
    switch (sort) {
      case 'createdAt': return files.createdAt;
      case '-createdAt': return desc(files.createdAt);
      case 'updatedAt': return files.updatedAt;
      case 'name': return files.name;
      case '-name': return desc(files.name);
      case '-updatedAt':
      default: return desc(files.updatedAt);
    }
  })();

  const total = (await db.select({ n: count() }).from(files).where(where).get())?.n ?? 0;
  const rows = await db.select().from(files).where(where).orderBy(orderBy).limit(p.perPage).offset(p.offset);

  setPaginationHeaders(c, total, p, '/v1/files');
  const dtos = await Promise.all(rows.map(async (f) => {
    const cur = await getCurrentVersion(f.id, f.currentVersionId);
    const vCount = await getVersionCount(f.id);
    return toFileDto(f, {
      mimeType: cur?.mimeType ?? 'application/octet-stream',
      sizeBytes: cur?.sizeBytes ?? 0,
      versionCount: vCount,
    });
  }));
  return c.json(dtos);
});

app.post('/', async (c) => {
  const ownerId = c.get('userId');
  const declaredLen = Number(c.req.header('Content-Length') ?? 0);
  if (declaredLen && declaredLen > config.maxUploadBytes) {
    return payloadTooLarge(c, `max ${config.maxUploadBytes} bytes`);
  }
  const form = await c.req.parseBody();
  const content = form['content'];
  if (!(content instanceof File)) return badRequest(c, 'content field (file) is required');
  if (content.size > config.maxUploadBytes) return payloadTooLarge(c, `max ${config.maxUploadBytes} bytes`);

  const rawName = (typeof form['name'] === 'string' && form['name']) || content.name || 'unnamed';
  const name = sanitizeName(rawName);
  if (!name) return badRequest(c, 'name must be non-empty');
  if (name.length > MAX_NAME_LEN) return badRequest(c, `name must be ≤ ${MAX_NAME_LEN} chars`);
  const description = typeof form['description'] === 'string' ? form['description'] : null;
  if (description && description.length > MAX_DESCRIPTION_LEN) return badRequest(c, `description must be ≤ ${MAX_DESCRIPTION_LEN} chars`);
  const mimeType = content.type || 'application/octet-stream';

  const blob = await storeBlob(await content.arrayBuffer());

  const now = new Date().toISOString();
  const fileId = randomUUID();
  const versionId = randomUUID();

  try {
    db.transaction((tx) => {
      tx.insert(files).values({
        id: fileId,
        ownerId,
        name,
        description,
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      }).run();
      tx.insert(versions).values({
        id: versionId,
        fileId,
        versionNumber: 1,
        note: null,
        mimeType,
        sizeBytes: blob.sizeBytes,
        checksum: blob.checksum,
        storagePath: blob.storagePath,
        createdBy: ownerId,
        createdAt: now,
      }).run();
    });
  } catch (err) {
    await deleteBlob(blob.storagePath);
    throw err;
  }

  const created = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!created) {
    await deleteBlob(blob.storagePath);
    throw new Error('file row disappeared after insert');
  }
  const dto = toFileDto(created, { mimeType, sizeBytes: blob.sizeBytes, versionCount: 1 });
  c.header('Location', fileUrl(fileId));
  c.header('ETag', computeEtag(created));
  return c.json(dto, 201);
});

async function ownedFile(c: { get: (k: 'userId') => string }, fileId: string) {
  const ownerId = c.get('userId');
  const f = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.ownerId, ownerId))).get();
  return f ?? null;
}

app.get('/:fileId', async (c) => {
  const f = await ownedFile(c, c.req.param('fileId'));
  if (!f) return notFound(c);
  const etag = computeEtag(f);
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
  const cur = await getCurrentVersion(f.id, f.currentVersionId);
  const vCount = await getVersionCount(f.id);
  c.header('ETag', etag);
  return c.json(toFileDto(f, {
    mimeType: cur?.mimeType ?? 'application/octet-stream',
    sizeBytes: cur?.sizeBytes ?? 0,
    versionCount: vCount,
  }));
});

app.patch('/:fileId', async (c) => {
  const f = await ownedFile(c, c.req.param('fileId'));
  if (!f) return notFound(c);

  const ct = c.req.header('Content-Type') ?? '';
  if (!ct.startsWith('application/merge-patch+json') && !ct.startsWith('application/json')) {
    return problem(c, { status: 415, title: 'Unsupported Media Type', detail: 'expected application/merge-patch+json' });
  }

  const preFail = requireIfMatch(c, computeEtag(f));
  if (preFail) return preFail;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest(c, 'json body required');

  const ALLOWED_KEYS = new Set(['name', 'description']);
  for (const k of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(k)) return badRequest(c, `unknown field: ${k}`);
  }

  const updates: Partial<typeof files.$inferInsert> = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !sanitizeName(body.name)) return badRequest(c, 'name must be non-empty string');
    if (body.name.length > MAX_NAME_LEN) return badRequest(c, `name must be ≤ ${MAX_NAME_LEN} chars`);
    updates.name = sanitizeName(body.name);
  }
  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string') return badRequest(c, 'description must be string or null');
    if (typeof body.description === 'string' && body.description.length > MAX_DESCRIPTION_LEN) {
      return badRequest(c, `description must be ≤ ${MAX_DESCRIPTION_LEN} chars`);
    }
    updates.description = body.description;
  }
  updates.updatedAt = new Date().toISOString();

  await db.update(files).set(updates).where(eq(files.id, f.id));
  const updated = (await db.select().from(files).where(eq(files.id, f.id)).get())!;
  const cur = await getCurrentVersion(updated.id, updated.currentVersionId);
  const vCount = await getVersionCount(updated.id);
  c.header('ETag', computeEtag(updated));
  return c.json(toFileDto(updated, {
    mimeType: cur?.mimeType ?? 'application/octet-stream',
    sizeBytes: cur?.sizeBytes ?? 0,
    versionCount: vCount,
  }));
});

app.delete('/:fileId', async (c) => {
  const f = await ownedFile(c, c.req.param('fileId'));
  if (!f) return notFound(c);
  // If-Match is optional on DELETE — skip the check when the header is absent
  // so scripted bulk deletes don't need to fetch first, but honor it when given.
  if (c.req.header('If-Match')) {
    const preFail = requireIfMatch(c, computeEtag(f));
    if (preFail) return preFail;
  }
  const allVersions = await db.select().from(versions).where(eq(versions.fileId, f.id));
  await db.delete(files).where(eq(files.id, f.id));
  await Promise.all(allVersions.map((v) => deleteBlob(v.storagePath)));
  return c.body(null, 204);
});

export default app;
