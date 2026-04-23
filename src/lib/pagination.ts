import type { Context } from 'hono';

export type Pagination = { page: number; perPage: number; offset: number };

export function readPagination(c: Context): Pagination {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number(c.req.query('perPage') ?? 20) || 20),
  );
  return { page, perPage, offset: (page - 1) * perPage };
}

export function setPaginationHeaders(
  c: Context,
  total: number,
  p: Pagination,
  basePath: string,
) {
  c.header('X-Total-Count', String(total));
  const lastPage = Math.max(1, Math.ceil(total / p.perPage));

  // Preserve the caller's other query params (e.g. name=, sort=) so that
  // following rel="next" doesn't silently broaden the result set.
  const passthrough = new URLSearchParams();
  for (const [k, v] of Object.entries(c.req.query())) {
    if (k === 'page' || k === 'perPage') continue;
    if (v != null) passthrough.append(k, String(v));
  }
  const url = (page: number) => {
    const q = new URLSearchParams(passthrough);
    q.set('page', String(page));
    q.set('perPage', String(p.perPage));
    return `${basePath}?${q.toString()}`;
  };

  const links: string[] = [`<${url(p.page)}>; rel="self"`];
  if (p.page < lastPage) links.push(`<${url(p.page + 1)}>; rel="next"`);
  if (p.page > 1) links.push(`<${url(p.page - 1)}>; rel="prev"`);
  links.push(`<${url(1)}>; rel="first"`);
  links.push(`<${url(lastPage)}>; rel="last"`);
  c.header('Link', links.join(', '));
}
