import { Hono } from 'hono';
import { and, desc, eq, like, count } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../db/client.ts';
import { files, versions } from '../db/schema.ts';
import { requireAuth, type AuthVars } from '../lib/auth.ts';
import { badRequest, notFound, payloadTooLarge, preconditionFailed } from '../lib/errors.ts';
import { toFileDto } from '../lib/dto.ts';
import { fileUrl } from '../lib/hateoas.ts';
import { readPagination, setPaginationHeaders } from '../lib/pagination.ts';
import { storeBlob, deleteBlob } from '../lib/storage.ts';
import { config } from '../config.ts';

const app = new Hono<{ Variables: AuthVars }>();
app.use('*', requireAuth);

function computeEtag(file: typeof files.$inferSelect) {
  return '"' + createHash('sha1').update(file.id + file.updatedAt).digest('hex') + '"';
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

  const where = nameFilter
    ? and(eq(files.ownerId, ownerId), like(files.name, `%${nameFilter}%`))
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
  const form = await c.req.parseBody();
  const content = form['content'];
  if (!(content instanceof File)) return badRequest(c, 'content field (file) is required');
  if (content.size > config.maxUploadBytes) return payloadTooLarge(c, `max ${config.maxUploadBytes} bytes`);

  const name = (typeof form['name'] === 'string' && form['name']) || content.name || 'unnamed';
  const description = typeof form['description'] === 'string' ? form['description'] : null;
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

  const ifMatch = c.req.header('If-Match');
  if (ifMatch && ifMatch !== computeEtag(f)) return preconditionFailed(c);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest(c, 'json body required');

  const updates: Partial<typeof files.$inferInsert> = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) return badRequest(c, 'name must be non-empty string');
    updates.name = body.name;
  }
  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string') return badRequest(c, 'description must be string or null');
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
  const allVersions = await db.select().from(versions).where(eq(versions.fileId, f.id));
  await db.delete(files).where(eq(files.id, f.id));
  await Promise.all(allVersions.map((v) => deleteBlob(v.storagePath)));
  return c.body(null, 204);
});

export default app;
