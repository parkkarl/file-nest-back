import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '../db/client.ts';
import { files, shares, versions } from '../db/schema.ts';
import { requireAuth, type AuthVars } from '../lib/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { toShareDto } from '../lib/dto.ts';
import { shareResourceUrl } from '../lib/hateoas.ts';

const app = new Hono<{ Variables: AuthVars }>();
app.use('*', requireAuth);

const generateToken = () => randomBytes(18).toString('base64url');

async function ownedFile(ownerId: string, fileId: string) {
  return await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId)))
    .get();
}

app.get('/:fileId/shares', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.fileId, f.id), isNull(shares.revokedAt)))
    .orderBy(desc(shares.createdAt));
  return c.json(rows.map(toShareDto));
});

app.post('/:fileId/shares', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);

  const body = await c.req.json().catch(() => ({}));

  let versionId: string | null = null;
  if (body.versionId) {
    const v = await db
      .select()
      .from(versions)
      .where(and(eq(versions.id, body.versionId), eq(versions.fileId, f.id)))
      .get();
    if (!v) return badRequest(c, 'versionId does not belong to this file');
    versionId = v.id;
  }

  if (body.expiresAt && isNaN(Date.parse(body.expiresAt))) {
    return badRequest(c, 'expiresAt must be a valid ISO-8601 timestamp');
  }
  if (body.maxDownloads != null && (!Number.isInteger(body.maxDownloads) || body.maxDownloads < 1)) {
    return badRequest(c, 'maxDownloads must be a positive integer');
  }

  const passwordHash = body.password ? await Bun.password.hash(String(body.password)) : null;

  const id = randomUUID();
  const token = generateToken();
  const now = new Date().toISOString();

  await db.insert(shares).values({
    id,
    fileId: f.id,
    versionId,
    token,
    passwordHash,
    expiresAt: body.expiresAt ?? null,
    maxDownloads: body.maxDownloads ?? null,
    downloadCount: 0,
    createdAt: now,
    revokedAt: null,
  });

  const created = (await db.select().from(shares).where(eq(shares.id, id)).get())!;
  c.header('Location', shareResourceUrl(f.id, id));
  return c.json(toShareDto(created), 201);
});

app.get('/:fileId/shares/:shareId', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const s = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, c.req.param('shareId')), eq(shares.fileId, f.id)))
    .get();
  if (!s) return notFound(c);
  return c.json(toShareDto(s));
});

app.delete('/:fileId/shares/:shareId', async (c) => {
  const ownerId = c.get('userId');
  const f = await ownedFile(ownerId, c.req.param('fileId'));
  if (!f) return notFound(c);
  const s = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, c.req.param('shareId')), eq(shares.fileId, f.id)))
    .get();
  if (!s) return notFound(c);
  if (s.revokedAt) return c.body(null, 204);
  await db.update(shares).set({ revokedAt: new Date().toISOString() }).where(eq(shares.id, s.id));
  return c.body(null, 204);
});

export default app;
