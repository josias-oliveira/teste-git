import type { Context } from 'hono';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createRun, updateRun, isFileProcessed, markFileSuccess, markFileError, saveTask, getLastSuccessfulRunTime } from '../db.js';
import { listNewFiles, getMostRecentFile } from './drive.js';
import { extractTranscript } from './transcript.js';
import { analyzeTranscript } from './claude.js';
import { createMeetingPage, appendTranscriptChunks, createTasks } from './notion.js';

const TIMEOUT_MS = 5 * 60 * 1000;
const MIN_TRANSCRIPT_CHARS = 50;
let isRunning = false;

interface FileError { fileName: string; step: string; error: string; }

export async function processCron(c: Context) {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${config.app.cronSecret}`) return c.json({ error: 'Unauthorized' }, 401);
  if (isRunning) return c.json({ error: 'Já existe uma execução em andamento' }, 409);

  isRunning = true;
  const runId = createRun();
  const fileErrors: FileError[] = [];
  const timeoutHandle = setTimeout(() => { isRunning = false; }, TIMEOUT_MS);

  try {
    const sinceTimestamp = getLastSuccessfulRunTime() ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let files;
    try {
      files = await listNewFiles(sinceTimestamp);
    } catch (err) {
      const msg = errMsg(err);
      updateRun(runId, { filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, status: 'error', errorMessage: `Drive API: ${msg}` });
      return c.json({ runId, error: `Falha ao acessar Google Drive: ${msg}` }, 500);
    }

    let processed = 0, skipped = 0, errored = 0;

    for (const file of files) {
      if (isFileProcessed(file.id)) { skipped++; continue; }
      let step = '';
      try {
        step = 'extração da transcrição';
        const { transcript } = await extractTranscript(file.id, file.name, file.createdTime, file.mimeType);
        if (transcript.length < MIN_TRANSCRIPT_CHARS) { skipped++; continue; }

        step = 'análise por IA';
        const claudeResult = await analyzeTranscript(transcript);

        step = 'criação da página no Notion';
        const meetingPageId = await createMeetingPage(file.name, file.id, file.createdTime, claudeResult.summary);

        step = 'upload da transcrição no Notion';
        await appendTranscriptChunks(meetingPageId, transcript);

        step = 'criação das tasks no Notion';
        const tasksCreated = await createTasks(claudeResult.tasks, file.name);

        markFileSuccess(file.id, file.name, meetingPageId, tasksCreated.length);
        for (const task of tasksCreated) saveTask(runId, file.id, task.title, '', task.notionPageId);
        processed++;
        logger.info('Arquivo processado', { name: file.name, tasks: tasksCreated.length });
      } catch (err) {
        const msg = errMsg(err);
        markFileError(file.id, file.name, `[${step}] ${msg}`);
        fileErrors.push({ fileName: file.name, step, error: msg });
        errored++;
      }
    }

    const status = errored === 0 ? 'success' : processed === 0 ? 'error' : 'partial';
    updateRun(runId, { filesFound: files.length, filesProcessed: processed, filesSkipped: skipped, filesErrored: errored, status });
    return c.json({ runId, status, filesFound: files.length, filesProcessed: processed, filesSkipped: skipped, filesErrored: errored, errors: fileErrors });
  } catch (err) {
    const msg = errMsg(err);
    updateRun(runId, { filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, status: 'error', errorMessage: msg });
    return c.json({ runId, error: msg, errors: fileErrors }, 500);
  } finally {
    clearTimeout(timeoutHandle);
    isRunning = false;
  }
}

export async function processLatestFile(c: Context) {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${config.app.cronSecret}`) return c.json({ error: 'Unauthorized' }, 401);
  if (isRunning) return c.json({ error: 'Já existe uma execução em andamento' }, 409);

  isRunning = true;
  const runId = createRun();
  const fileErrors: FileError[] = [];

  try {
    const file = await getMostRecentFile();
    if (!file) {
      updateRun(runId, { filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, status: 'success' });
      return c.json({ runId, status: 'success', filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, errors: [] });
    }

    let step = '';
    try {
      step = 'extração da transcrição';
      const { transcript } = await extractTranscript(file.id, file.name, file.createdTime, file.mimeType);
      if (transcript.length < MIN_TRANSCRIPT_CHARS) {
        updateRun(runId, { filesFound: 1, filesProcessed: 0, filesSkipped: 1, filesErrored: 0, status: 'success' });
        return c.json({ runId, status: 'success', filesFound: 1, filesProcessed: 0, filesSkipped: 1, filesErrored: 0, errors: [], warn: 'Transcrição muito curta' });
      }

      step = 'análise por IA';
      const claudeResult = await analyzeTranscript(transcript);

      step = 'criação da página no Notion';
      const meetingPageId = await createMeetingPage(file.name, file.id, file.createdTime, claudeResult.summary);

      step = 'upload da transcrição';
      await appendTranscriptChunks(meetingPageId, transcript);

      step = 'criação das tasks';
      const tasksCreated = await createTasks(claudeResult.tasks, file.name);

      markFileSuccess(file.id, file.name, meetingPageId, tasksCreated.length);
      for (const task of tasksCreated) saveTask(runId, file.id, task.title, '', task.notionPageId);
      updateRun(runId, { filesFound: 1, filesProcessed: 1, filesSkipped: 0, filesErrored: 0, status: 'success' });
      return c.json({ runId, status: 'success', filesFound: 1, filesProcessed: 1, filesSkipped: 0, filesErrored: 0, errors: [] });
    } catch (err) {
      const msg = errMsg(err);
      markFileError(file.id, file.name, `[${step}] ${msg}`);
      fileErrors.push({ fileName: file.name, step, error: msg });
      updateRun(runId, { filesFound: 1, filesProcessed: 0, filesSkipped: 0, filesErrored: 1, status: 'error' });
      return c.json({ runId, status: 'error', filesFound: 1, filesProcessed: 0, filesSkipped: 0, filesErrored: 1, errors: fileErrors }, 500);
    }
  } catch (err) {
    const msg = errMsg(err);
    updateRun(runId, { filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, status: 'error', errorMessage: msg });
    return c.json({ runId, error: msg, errors: fileErrors }, 500);
  } finally {
    isRunning = false;
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack.split('\n').slice(1, 3).join('\n')}` : err.message;
  return String(err);
}
