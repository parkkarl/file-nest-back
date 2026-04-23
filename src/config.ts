const isProd = process.env.NODE_ENV === 'production';
const DEV_PLACEHOLDER_SECRET = 'dev-secret-change-me';

function resolveJwtSecret() {
  const raw = process.env.JWT_SECRET?.trim();
  if (!raw) {
    if (isProd) throw new Error('JWT_SECRET must be set in production');
    return DEV_PLACEHOLDER_SECRET;
  }
  if (isProd && (raw === DEV_PLACEHOLDER_SECRET || raw.length < 32)) {
    throw new Error('JWT_SECRET must be at least 32 chars and must not be the dev placeholder in production');
  }
  return raw;
}

function resolveAllowedOrigins(): string[] | '*' {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return isProd ? [process.env.PUBLIC_BASE_URL ?? ''].filter(Boolean) : '*';
  if (raw === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  jwtSecret: resolveJwtSecret(),
  allowedOrigins: resolveAllowedOrigins(),
  databaseUrl: process.env.DATABASE_URL ?? './data/file-nest.db',
  storageDir: process.env.STORAGE_DIR ?? './storage',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
};
