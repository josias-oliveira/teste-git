import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/app.db');
let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS processed_files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      error_message TEXT,
      notion_page_id TEXT,
      tasks_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      files_found INTEGER DEFAULT 0,
      files_processed INTEGER DEFAULT 0,
      files_skipped INTEGER DEFAULT 0,
      files_errored INTEGER DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'partial', 'error')),
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks_created (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      file_id TEXT NOT NULL REFERENCES processed_files(id),
      task_title TEXT NOT NULL,
      task_priority TEXT NOT NULL,
      notion_page_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function isFileProcessed(fileId: string): boolean {
  return !!getDb().prepare('SELECT id FROM processed_files WHERE id = ?').get(fileId);
}

export function markFileSuccess(fileId: string, fileName: string, notionPageId: string, tasksCount: number) {
  getDb().prepare(`INSERT OR REPLACE INTO processed_files (id, file_name, processed_at, status, notion_page_id, tasks_count) VALUES (?, ?, ?, 'success', ?, ?)`)
    .run(fileId, fileName, new Date().toISOString(), notionPageId, tasksCount);
}

export function markFileError(fileId: string, fileName: string, errorMessage: string) {
  getDb().prepare(`INSERT OR REPLACE INTO processed_files (id, file_name, processed_at, status, error_message) VALUES (?, ?, ?, 'error', ?)`)
    .run(fileId, fileName, new Date().toISOString(), errorMessage);
}

export function createRun(): number {
  return Number(getDb().prepare(`INSERT INTO runs (started_at, status) VALUES (?, 'running')`).run(new Date().toISOString()).lastInsertRowid);
}

export function updateRun(runId: number, data: { filesFound: number; filesProcessed: number; filesSkipped: number; filesErrored: number; status: 'success' | 'partial' | 'error'; errorMessage?: string }) {
  getDb().prepare(`UPDATE runs SET finished_at=?, files_found=?, files_processed=?, files_skipped=?, files_errored=?, status=?, error_message=? WHERE id=?`)
    .run(new Date().toISOString(), data.filesFound, data.filesProcessed, data.filesSkipped, data.filesErrored, data.status, data.errorMessage ?? null, runId);
}

export function getLastSuccessfulRunTime(): string | null {
  const row = getDb().prepare(`SELECT started_at FROM runs WHERE status IN ('success', 'partial') ORDER BY id DESC LIMIT 1`).get() as { started_at: string } | undefined;
  return row?.started_at ?? null;
}

export function getRecentRuns(limit = 50) {
  return getDb().prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT ?`).all(limit) as RunRow[];
}

export function getRunById(runId: number) {
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
}

export function getProcessedFilesByRunTime(runStartedAt: string, runFinishedAt: string | null) {
  const end = runFinishedAt ?? new Date().toISOString();
  return getDb().prepare(`SELECT * FROM processed_files WHERE processed_at >= ? AND processed_at <= ?`).all(runStartedAt, end) as ProcessedFileRow[];
}

export function getTasksByFileId(fileId: string) {
  return getDb().prepare('SELECT * FROM tasks_created WHERE file_id = ?').all(fileId) as TaskRow[];
}

export function saveTask(runId: number, fileId: string, taskTitle: string, taskPriority: string, notionPageId: string) {
  getDb().prepare(`INSERT INTO tasks_created (run_id, file_id, task_title, task_priority, notion_page_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(runId, fileId, taskTitle, taskPriority, notionPageId, new Date().toISOString());
}

export interface RunRow {
  id: number; started_at: string; finished_at: string | null;
  files_found: number; files_processed: number; files_skipped: number; files_errored: number;
  status: 'running' | 'success' | 'partial' | 'error'; error_message: string | null;
}
export interface ProcessedFileRow {
  id: string; file_name: string; processed_at: string;
  status: 'success' | 'error'; error_message: string | null;
  notion_page_id: string | null; tasks_count: number;
}
export interface TaskRow {
  id: number; run_id: number; file_id: string;
  task_title: string; task_priority: string; notion_page_id: string; created_at: string;
}
