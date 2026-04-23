import type { Context } from 'hono';

type ProblemInput = {
  status: number;
  title: string;
  detail?: string;
  type?: string;
};

export function problem(c: Context, p: ProblemInput) {
  const body = {
    type: p.type ?? 'about:blank',
    title: p.title,
    status: p.status,
    detail: p.detail,
    instance: new URL(c.req.url).pathname,
  };
  c.header('Content-Type', 'application/problem+json');
  return c.body(JSON.stringify(body), p.status as never);
}

export const badRequest = (c: Context, detail?: string) =>
  problem(c, { status: 400, title: 'Bad Request', detail });
export const unauthorized = (c: Context, detail?: string) =>
  problem(c, { status: 401, title: 'Unauthorized', detail });
export const forbidden = (c: Context, detail?: string) =>
  problem(c, { status: 403, title: 'Forbidden', detail });
export const notFound = (c: Context, detail?: string) =>
  problem(c, { status: 404, title: 'Not Found', detail });
export const conflict = (c: Context, detail?: string) =>
  problem(c, { status: 409, title: 'Conflict', detail });
export const gone = (c: Context, detail?: string) =>
  problem(c, { status: 410, title: 'Gone', detail });
export const preconditionFailed = (c: Context, detail?: string) =>
  problem(c, { status: 412, title: 'Precondition Failed', detail });
export const payloadTooLarge = (c: Context, detail?: string) =>
  problem(c, { status: 413, title: 'Payload Too Large', detail });
