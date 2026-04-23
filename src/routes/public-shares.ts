import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { files, shares, versions } from '../db/schema.ts';
import { gone, notFound, unauthorized } from '../lib/errors.ts';
import { toPublicShareDto } from '../lib/dto.ts';
import { readBlob } from '../lib/storage.ts';
import { contentDispositionAttachment } from '../lib/http.ts';

const app = new Hono();

type ResolvedShare = {
  share: typeof shares.$inferSelect;
  version: typeof versions.$inferSelect;
  file: typeof files.$inferSelect;
};

async function resolveShare(token: string): Promise<
  | { ok: true; value: ResolvedShare }
  | { ok: false; status: 'not_found' | 'gone' | 'unauthorized_password_missing' | 'unauthorized_password_wrong'; reason?: string }
> {
  const s = await db.select().from(shares).where(eq(shares.token, token)).get();
  if (!s) return { ok: false, status: 'not_found' };
  if (s.revokedAt) return { ok: false, status: 'gone', reason: 'revoked' };
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return { ok: false, status: 'gone', reason: 'expired' };
  if (s.maxDownloads != null && s.downloadCount >= s.maxDownloads) {
    return { ok: false, status: 'gone', reason: 'download limit reached' };
  }

  const file = await db.select().from(files).where(eq(files.id, s.fileId)).get();
  if (!file) return { ok: false, status: 'not_found' };

  let version: typeof versions.$inferSelect | undefined;
  if (s.versionId) {
    version = await db.select().from(versions).where(eq(versions.id, s.versionId)).get();
  } else {
    version = await db
      .select()
      .from(versions)
      .where(eq(versions.fileId, file.id))
      .orderBy(desc(versions.versionNumber))
      .get();
  }
  if (!version) return { ok: false, status: 'not_found' };

  return { ok: true, value: { share: s, version, file } };
}

async function checkPassword(
  c: { req: { header: (k: string) => string | undefined } },
  s: typeof shares.$inferSelect,
): Promise<'ok' | 'missing' | 'wrong'> {
  if (!s.passwordHash) return 'ok';
  const given = c.req.header('X-Share-Password');
  if (!given) return 'missing';
  const ok = await Bun.password.verify(given, s.passwordHash);
  return ok ? 'ok' : 'wrong';
}

app.get('/:token', async (c) => {
  const resolved = await resolveShare(c.req.param('token'));
  if (!resolved.ok) {
    if (resolved.status === 'not_found') return notFound(c);
    return gone(c, resolved.reason);
  }
  const pwd = await checkPassword(c, resolved.value.share);
  if (pwd !== 'ok') return unauthorized(c, 'password required or incorrect');
  const { share, version, file } = resolved.value;
  return c.json(toPublicShareDto(share, version, file));
});

app.get('/:token/content', async (c) => {
  const resolved = await resolveShare(c.req.param('token'));
  if (!resolved.ok) {
    if (resolved.status === 'not_found') return notFound(c);
    return gone(c, resolved.reason);
  }
  const pwd = await checkPassword(c, resolved.value.share);
  if (pwd !== 'ok') return unauthorized(c, 'password required or incorrect');

  const { share, version, file } = resolved.value;

  // Guarded atomic increment — a single UPDATE … WHERE ensures that two
  // concurrent downloads cannot both pass a maxDownloads or expiry check.
  const nowIso = new Date().toISOString();
  const res = db
    .update(shares)
    .set({ downloadCount: sql`${shares.downloadCount} + 1` })
    .where(
      sql`${shares.id} = ${share.id}
        AND ${shares.revokedAt} IS NULL
        AND (${shares.maxDownloads} IS NULL OR ${shares.downloadCount} < ${shares.maxDownloads})
        AND (${shares.expiresAt} IS NULL OR ${shares.expiresAt} > ${nowIso})`,
    )
    .run();
  if ((res as unknown as { changes: number }).changes === 0) {
    return gone(c, 'download limit reached or link expired');
  }

  return new Response(readBlob(version.storagePath), {
    headers: {
      'Content-Type': version.mimeType,
      'Content-Length': String(version.sizeBytes),
      'Content-Disposition': contentDispositionAttachment(file.name),
      'X-Content-Type-Options': 'nosniff',
      'ETag': `"${version.checksum}"`,
    },
  });
});

export default app;
