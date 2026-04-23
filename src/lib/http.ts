import type { Context } from 'hono';
import { preconditionFailed, problem } from './errors.ts';

/**
 * RFC 6266 / 5987 Content-Disposition for attachments.
 * Emits an ASCII-safe filename= fallback plus filename*=UTF-8'' for clients
 * that support the extended form. Strips CR/LF and quote characters to
 * preclude header injection.
 */
export function contentDispositionAttachment(name: string): string {
  const cleaned = name.replace(/[\r\n]+/g, ' ').trim() || 'download';
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const star = encodeURIComponent(cleaned);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/**
 * Check an incoming `If-Match` header against a resource ETag.
 * Returns `null` on success (callers should continue). Returns a response
 * on failure (412 on mismatch, 428 when the header is missing).
 *
 * Supports `*` (matches any existing resource), comma-separated lists,
 * and weak/strong tags (both treated the same for simplicity).
 */
export function requireIfMatch(c: Context, etag: string): Response | null {
  const header = c.req.header('If-Match');
  if (!header) {
    return problem(c, {
      status: 428,
      title: 'Precondition Required',
      detail: 'If-Match header is required for this operation',
    });
  }
  const tags = header.split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.includes('*')) return null;
  if (tags.some((t) => stripWeak(t) === stripWeak(etag))) return null;
  return preconditionFailed(c, 'If-Match does not match the current ETag');
}

function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
