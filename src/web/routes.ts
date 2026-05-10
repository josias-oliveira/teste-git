import type { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRecentRuns, getRunById, getProcessedFilesByRunTime, getTasksByFileId, type RunRow, type ProcessedFileRow } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.resolve(__dirname, 'views');

function readView(name: string) { return readFileSync(path.join(VIEWS, name), 'utf8'); }
function layout(title: string, content: string) {
  return readView('layout.html').replace('{{TITLE}}', title).replace('{{CONTENT}}', content);
}
function statusBadge(status: RunRow['status']) {
  const map: Record<string, string> = { success: 'badge-success', partial: 'badge-partial', error: 'badge-error', running: 'badge-running' };
  return `<span class="badge ${map[status] ?? ''}">${status}</span>`;
}
function duration(start: string, end: string | null) {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function escHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerWebRoutes(app: Hono) {
  app.post('/dashboard/trigger', async c => {
    const { processLatestFile } = await import('../cron/process.js');
    const { config } = await import('../config.js');
    const fakeReq = { header: (n: string) => n === 'Authorization' ? `Bearer ${config.app.cronSecret}` : undefined };
    return processLatestFile({ ...c, req: { ...c.req, header: fakeReq.header } } as never);
  });

  app.get('/dashboard', c => {
    const runs = getRecentRuns(50);
    const statsHtml = runs.length > 0 ? `<div style="margin-bottom:24px">
      <div class="stat"><div class="stat-value">${runs.length}</div><div class="stat-label">runs totais</div></div>
      <div class="stat"><div class="stat-value">${runs.filter(r => r.status === 'success').length}</div><div class="stat-label">com sucesso</div></div>
      <div class="stat"><div class="stat-value">${runs.reduce((a, r) => a + r.files_processed, 0)}</div><div class="stat-label">arquivos processados</div></div>
    </div>` : '';
    const rowsHtml = runs.map(r => `<tr>
      <td><a href="/dashboard/${r.id}">#${r.id}</a></td>
      <td>${formatDate(r.started_at)}</td>
      <td>${duration(r.started_at, r.finished_at)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.files_found}</td><td>${r.files_processed}</td><td>—</td>
      <td style="color:${r.files_errored > 0 ? 'var(--red)' : 'inherit'}">${r.files_errored}</td>
    </tr>`).join('');
    const noRuns = runs.length === 0 ? '<p style="color:var(--muted);margin-top:24px">Nenhuma execução ainda.</p>' : '';
    const content = readView('dashboard.html').replace('{{STATS}}', statsHtml).replace('{{ROWS}}', rowsHtml).replace('{{NO_RUNS}}', noRuns).replace('{{LAYOUT_START}}', '').replace('{{LAYOUT_END}}', '');
    return c.html(layout('Dashboard', content));
  });

  app.get('/dashboard/:runId', c => {
    const runId = parseInt(c.req.param('runId'), 10);
    const run = getRunById(runId);
    if (!run) return c.html(layout('Não encontrado', '<p>Run não encontrado.</p>'), 404);
    const files = getProcessedFilesByRunTime(run.started_at, run.finished_at);
    const runErrorHtml = run.error_message ? `<div class="error-box" style="margin-bottom:16px">${escHtml(run.error_message)}</div>` : '';
    const filesHtml = files.map((f: ProcessedFileRow) => {
      const tasks = getTasksByFileId(f.id);
      const tasksHtml = tasks.length > 0 ? `<ul style="margin-top:8px;padding-left:16px;font-size:12px;color:var(--muted)">${tasks.map(t => `<li>${escHtml(t.task_title)}</li>`).join('')}</ul>` : '';
      const notionLink = f.notion_page_id ? `<a href="https://notion.so/${f.notion_page_id.replace(/-/g, '')}" target="_blank" style="font-size:12px">Ver no Notion</a>` : '';
      const errorBlock = f.error_message ? `<div class="error-box" style="margin-top:8px">${escHtml(f.error_message)}</div>` : '';
      return `<div class="card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">${statusBadge(f.status)}<strong>${escHtml(f.file_name)}</strong>${notionLink}</div><div style="color:var(--muted);font-size:12px">Processado em: ${formatDate(f.processed_at)} | Tasks: ${f.tasks_count}</div>${tasksHtml}${errorBlock}</div>`;
    }).join('');
    const noFiles = files.length === 0 ? '<p style="color:var(--muted)">Nenhum arquivo neste run.</p>' : '';
    const content = readView('detail.html')
      .replace('{{RUN_ID}}', String(run.id)).replace('{{STATUS_BADGE}}', statusBadge(run.status))
      .replace('{{FILES_FOUND}}', String(run.files_found)).replace('{{FILES_PROCESSED}}', String(run.files_processed))
      .replace('{{FILES_SKIPPED}}', String(run.files_skipped)).replace('{{FILES_ERRORED}}', String(run.files_errored))
      .replace('{{STARTED_AT}}', formatDate(run.started_at)).replace('{{FINISHED_AT}}', formatDate(run.finished_at))
      .replace('{{RUN_ERROR}}', runErrorHtml).replace('{{FILES}}', filesHtml).replace('{{NO_FILES}}', noFiles)
      .replace('{{LAYOUT_START}}', '').replace('{{LAYOUT_END}}', '');
    return c.html(layout(`Run #${runId}`, content));
  });
}
