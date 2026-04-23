import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config.ts';
import authRoutes from './routes/auth.ts';
import filesRoutes from './routes/files.ts';
import versionsRoutes from './routes/versions.ts';
import sharesRoutes from './routes/shares.ts';
import publicSharesRoutes from './routes/public-shares.ts';

const app = new Hono();

if (!config.isProd) app.use('*', logger());
app.use(
  '*',
  cors({
    origin: config.allowedOrigins === '*' ? '*' : (origin) =>
      (config.allowedOrigins as string[]).includes(origin) ? origin : null,
    allowHeaders: ['Authorization', 'Content-Type', 'If-Match', 'If-None-Match', 'X-Share-Password'],
    exposeHeaders: ['ETag', 'Location', 'Link', 'X-Total-Count'],
  }),
);

app.get('/', (c) =>
  c.json({
    name: 'File Nest API',
    version: '0.1.0',
    docs: `${config.publicBaseUrl}/openapi.json`,
  }),
);

app.get('/openapi.json', async (c) => {
  const spec = await Bun.file('./openapi.json').json();
  return c.json(spec);
});

app.route('/v1/auth', authRoutes);
app.route('/v1/files', filesRoutes);
app.route('/v1/files', versionsRoutes);
app.route('/v1/files', sharesRoutes);
app.route('/v1/shares', publicSharesRoutes);

app.notFound((c) => {
  c.header('Content-Type', 'application/problem+json');
  return c.body(
    JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, instance: new URL(c.req.url).pathname }),
    404,
  );
});

app.onError((err, c) => {
  console.error(err);
  c.header('Content-Type', 'application/problem+json');
  return c.body(
    JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: err.message }),
    500,
  );
});

export default {
  port: config.port,
  fetch: app.fetch,
};

console.log(`File Nest API listening on http://localhost:${config.port}`);
