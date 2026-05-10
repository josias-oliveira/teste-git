import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { getDb, getLastSuccessfulRunTime } from './db.js';
import { processCron, processLatestFile } from './cron/process.js';
import { registerWebRoutes } from './web/routes.js';
import { logger } from './utils/logger.js';

const app = new Hono();
getDb();

app.post('/cron/process', c => processCron(c));
app.get('/health', c => c.json({ status: 'ok', lastRun: getLastSuccessfulRunTime(), uptime: Math.floor(process.uptime()), env: config.app.nodeEnv }));
app.get('/', c => c.redirect('/dashboard'));

registerWebRoutes(app);

if (config.app.nodeEnv === 'development') {
  app.post('/dev/trigger', c => {
    const fakeReq = { header: (n: string) => n === 'Authorization' ? `Bearer ${config.app.cronSecret}` : undefined };
    return processCron({ ...c, req: { ...c.req, header: fakeReq.header } } as never);
  });

  app.get('/auth/google', c => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.google.clientId);
    url.searchParams.set('redirect_uri', `http://localhost:${config.app.port}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return c.redirect(url.toString());
  });

  app.get('/auth/callback', async c => {
    const code = c.req.query('code');
    if (!code) return c.text('Missing code', 400);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: `http://localhost:${config.app.port}/auth/callback`, grant_type: 'authorization_code' }),
    });
    const data = await res.json() as Record<string, unknown>;
    return c.html(`<h2>Refresh Token</h2><pre style="background:#111;color:#0f0;padding:16px">${JSON.stringify(data, null, 2)}</pre>`);
  });
}

serve({ fetch: app.fetch, port: config.app.port }, info => {
  logger.info('Server started', { port: info.port, env: config.app.nodeEnv });
  logger.info(`Dashboard: http://localhost:${info.port}/dashboard`);
  if (config.app.nodeEnv === 'development') {
    logger.info(`Auth: http://localhost:${info.port}/auth/google`);
  }
});
