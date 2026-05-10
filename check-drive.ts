import { config } from './src/config.js';

async function check() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token: string };
  const token = data.access_token;

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${config.google.driveFolderId}' in parents`);
  url.searchParams.set('fields', 'files(id,name,mimeType,createdTime,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '10');
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const files = await r.json();
  console.log(JSON.stringify(files, null, 2));
}
check();
