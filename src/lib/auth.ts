import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.ts';
import { sessions } from '../db/schema.ts';
import { config } from '../config.ts';
import { unauthorized } from './errors.ts';

export type JwtPayload = { sub: string; sid: string; email: string; iat: number; exp: number };

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(
  userId: string,
  email: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const sessionId = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ip ?? null,
    createdAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    revokedAt: null,
  });

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const token = await sign(
    { sub: userId, sid: sessionId, email, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS },
    config.jwtSecret,
  );

  return { token, sessionId, expiresAt: expires.toISOString() };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sessions.id, sessionId));
}

export type AuthVars = { userId: string; userEmail: string; sessionId: string };

export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return unauthorized(c, 'Missing Bearer token');
  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = (await verify(token, config.jwtSecret, 'HS256')) as JwtPayload;
  } catch {
    return unauthorized(c, 'Invalid or expired token');
  }

  const session = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, payload.sid),
        eq(sessions.userId, payload.sub),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .get();
  if (!session) return unauthorized(c, 'Session revoked or expired');

  await db
    .update(sessions)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(sessions.id, session.id));

  c.set('userId', payload.sub);
  c.set('userEmail', payload.email);
  c.set('sessionId', payload.sid);
  await next();
});
