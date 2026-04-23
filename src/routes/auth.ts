import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { createSession, requireAuth, revokeSession, type AuthVars } from '../lib/auth.ts';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.ts';

const app = new Hono<{ Variables: AuthVars }>();

// Precomputed hash of a random string: used to equalize timing when the user
// row is missing, so login latency can't distinguish "email known" from "email unknown".
const DUMMY_PASSWORD_HASH = await Bun.password.hash(randomUUID());

function sessionMeta(c: { req: { header: (k: string) => string | undefined } }) {
  return {
    userAgent: c.req.header('User-Agent'),
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? c.req.header('X-Real-IP'),
  };
}

function toSessionDto(s: typeof sessions.$inferSelect) {
  return {
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
  };
}

// POST /v1/auth/users — register a new user
app.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.email || !body?.password) return badRequest(c, 'email and password required');
  if (String(body.password).length < 8) return badRequest(c, 'password must be at least 8 characters');

  const existing = await db.select().from(users).where(eq(users.email, body.email)).get();
  if (existing) return conflict(c, 'email already registered');

  const id = randomUUID();
  const passwordHash = await Bun.password.hash(body.password);
  const createdAt = new Date().toISOString();
  await db.insert(users).values({ id, email: body.email, passwordHash, createdAt });

  const { token, expiresAt } = await createSession(id, body.email, sessionMeta(c));
  c.header('Location', `/v1/auth/users/${id}`);
  return c.json({ token, expiresAt, user: { id, email: body.email } }, 201);
});

// POST /v1/auth/sessions — create a session (login)
app.post('/sessions', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.email || !body?.password) return badRequest(c, 'email and password required');

  const user = await db.select().from(users).where(eq(users.email, body.email)).get();
  // Always run verify (against a dummy hash when the user doesn't exist) so login
  // latency doesn't leak whether the email is registered.
  const ok = await Bun.password.verify(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) return unauthorized(c, 'invalid credentials');

  const { token, sessionId, expiresAt } = await createSession(user.id, user.email, sessionMeta(c));
  c.header('Location', `/v1/auth/sessions/${sessionId}`);
  return c.json({ token, expiresAt, session: { id: sessionId }, user: { id: user.id, email: user.email } }, 201);
});

// GET /v1/auth/sessions — list active sessions for the current user
app.get('/sessions', requireAuth, async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastUsedAt));
  return c.json(rows.map(toSessionDto));
});

// GET /v1/auth/sessions/current — inspect the current session
app.get('/sessions/current', requireAuth, async (c) => {
  const sid = c.get('sessionId');
  const s = await db.select().from(sessions).where(eq(sessions.id, sid)).get();
  if (!s) return notFound(c);
  return c.json(toSessionDto(s));
});

// DELETE /v1/auth/sessions/current — revoke the current session (logout)
app.delete('/sessions/current', requireAuth, async (c) => {
  const sid = c.get('sessionId');
  await revokeSession(sid);
  return c.body(null, 204);
});

// DELETE /v1/auth/sessions/:sessionId — revoke a specific session (e.g. sign out another device)
app.delete('/sessions/:sessionId', requireAuth, async (c) => {
  const userId = c.get('userId');
  const sid = c.req.param('sessionId');
  const s = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sid), eq(sessions.userId, userId)))
    .get();
  if (!s) return notFound(c);
  await revokeSession(sid);
  return c.body(null, 204);
});

export default app;
