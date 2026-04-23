import { Hono } from 'hono';
import { and, desc, eq, count, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.ts';
import { files, versions } from '../db/schema.ts';
import { requireAuth, type AuthVars } from '../lib/auth.ts';
import { badRequest, conflict, notFound, payloadTooLarge } from '../lib/errors.ts';
import { toVersionDto } from '../lib/dto.ts';
import { versionUrl } from '../lib/hateoas.ts';
import { readPagination, setPaginationHeaders } from '../lib/pagination.ts';
import { deleteBlob, readBlob, storeBlob } from '../lib/storage.ts';
import { contentDispositionAttachment } from '../lib/http.ts';
import { config } from '../config.ts';

const app = new Hono<{ Variables: AuthVars }>();
app.use('*', requireAuth);

async function ownedFile(ownerId: string, fileId: string) {
  return await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId)))
    .get();
}

app.get('/:fileId/versions', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const p = readPagination(c);
  const total = (await db.select({ n: count() }).from(versions).where(eq(versions.fileId, f.id)).get())?.n ?? 0;
  const rows = await db
    .select()
    .from(versions)
    .where(eq(versions.fileId, f.id))
    .orderBy(desc(versions.versionNumber))
    .limit(p.perPage)
    .offset(p.offset);
  setPaginationHeaders(c, total, p, `/v1/files/${f.id}/versions`);
  return c.json(rows.map(toVersionDto));
});

app.post('/:fileId/versions', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);

  const declaredLen = Number(c.req.header('Content-Length') ?? 0);
  if (declaredLen && declaredLen > config.maxUploadBytes) {
    return payloadTooLarge(c, `max ${config.maxUploadBytes} bytes`);
  }
  const form = await c.req.parseBody();
  const content = form['content'];
  if (!(content instanceof File)) return badRequest(c, 'content field (file) is required');
  if (content.size > config.maxUploadBytes) return payloadTooLarge(c, `max ${config.maxUploadBytes} bytes`);

  const note = typeof form['note'] === 'string' ? form['note'] : null;
  const mimeType = content.type || 'application/octet-stream';
  const blob = await storeBlob(await content.arrayBuffer());

  const now = new Date().toISOString();
  const versionId = randomUUID();

  try {
    // max-select + insert in the same transaction so concurrent uploads
    // can't both read the same max and collide on the UNIQUE(fileId, versionNumber)
    db.transaction((tx) => {
      const maxRow = tx
        .select({ m: max(versions.versionNumber) })
        .from(versions)
        .where(eq(versions.fileId, f.id))
        .get();
      const nextNumber = (maxRow?.m ?? 0) + 1;
      tx.insert(versions).values({
        id: versionId,
        fileId: f.id,
        versionNumber: nextNumber,
        note,
        mimeType,
        sizeBytes: blob.sizeBytes,
        checksum: blob.checksum,
        storagePath: blob.storagePath,
        createdBy: ownerId,
        createdAt: now,
      }).run();
      tx.update(files).set({ currentVersionId: versionId, updatedAt: now }).where(eq(files.id, f.id)).run();
    });
  } catch (err) {
    await deleteBlob(blob.storagePath);
    throw err;
  }

  const created = (await db.select().from(versions).where(eq(versions.id, versionId)).get())!;
  c.header('Location', versionUrl(f.id, versionId));
  return c.json(toVersionDto(created), 201);
});

app.get('/:fileId/versions/:versionId', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const v = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, c.req.param('versionId')), eq(versions.fileId, f.id)))
    .get();
  if (!v) return notFound(c);
  return c.json(toVersionDto(v));
});

app.delete('/:fileId/versions/:versionId', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const v = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, c.req.param('versionId')), eq(versions.fileId, f.id)))
    .get();
  if (!v) return notFound(c);

  const total = (await db.select({ n: count() }).from(versions).where(eq(versions.fileId, f.id)).get())?.n ?? 0;
  if (total <= 1) return conflict(c, 'cannot delete the only remaining version; delete the file instead');

  await db.delete(versions).where(eq(versions.id, v.id));
  await deleteBlob(v.storagePath);

  // If we just removed the current version, promote the newest remaining one
  if (f.currentVersionId === v.id) {
    const latest = await db.select().from(versions).where(eq(versions.fileId, f.id)).orderBy(desc(versions.versionNumber)).get();
    await db.update(files)
      .set({ currentVersionId: latest?.id ?? null, updatedAt: new Date().toISOString() })
      .where(eq(files.id, f.id));
  }
  return c.body(null, 204);
});

app.get('/:fileId/versions/:versionId/content', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const v = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, c.req.param('versionId')), eq(versions.fileId, f.id)))
    .get();
  if (!v) return notFound(c);

  return new Response(readBlob(v.storagePath), {
    headers: {
      'Content-Type': v.mimeType,
      'Content-Length': String(v.sizeBytes),
      'Content-Disposition': contentDispositionAttachment(f.name),
      'X-Content-Type-Options': 'nosniff',
      'ETag': `"${v.checksum}"`,
    },
  });
});

export default app;
