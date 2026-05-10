import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface DriveFile {
  id: string; name: string; mimeType: string; createdTime: string; modifiedTime: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) return cachedAccessToken.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId, client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Failed to refresh Google token: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  logger.info('Google access token refreshed');
  return cachedAccessToken.token;
}

export async function listNewFiles(sinceTimestamp: string): Promise<DriveFile[]> {
  const token = await getAccessToken();
  const q = [
    `'${config.google.driveFolderId}' in parents`,
    `(mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')`,
    `modifiedTime > '${sinceTimestamp}'`,
  ].join(' and ');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id,name,mimeType,createdTime,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { files: DriveFile[] };
  logger.info('Drive files fetched', { count: data.files.length });
  return data.files;
}

export async function getMostRecentFile(): Promise<DriveFile | null> {
  const token = await getAccessToken();
  const q = [
    `'${config.google.driveFolderId}' in parents`,
    `(mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')`,
  ].join(' and ');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id,name,mimeType,createdTime,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '1');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { files: DriveFile[] };
  logger.info('Most recent file', { file: data.files[0]?.name ?? 'none' });
  return data.files[0] ?? null;
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download error: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

export { getAccessToken };
