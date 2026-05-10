import { getAccessToken, downloadFile } from './drive.js';
import { logger } from '../utils/logger.js';
import mammoth from 'mammoth';

export interface TranscriptResult {
  transcript: string; fileName: string; fileId: string; fileDate: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function normalize(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface DocTab {
  tabProperties?: { title?: string };
  documentTab?: { body?: { content?: DocContent[] } };
  childTabs?: DocTab[];
}
interface DocContent {
  paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocContent[] }> }> };
}

function walkTabs(tabs: DocTab[]): DocTab[] {
  const result: DocTab[] = [];
  for (const tab of tabs) {
    result.push(tab);
    if (tab.childTabs?.length) result.push(...walkTabs(tab.childTabs));
  }
  return result;
}

function extractText(contents: DocContent[]): string {
  let text = '';
  for (const item of contents) {
    if (item.paragraph?.elements) {
      for (const el of item.paragraph.elements) {
        if (el.textRun?.content) text += el.textRun.content;
      }
    }
    if (item.table?.tableRows) {
      for (const row of item.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          if (cell.content) text += extractText(cell.content);
        }
      }
    }
  }
  return text;
}

async function extractFromDocx(fileId: string): Promise<string> {
  const buffer = await downloadFile(fileId);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractFromGoogleDoc(fileId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${fileId}?includeTabsContent=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Docs API error: ${res.status} ${await res.text()}`);
  const doc = await res.json() as { tabs?: DocTab[] };
  if (!doc.tabs?.length) throw new Error('Document has no tabs');
  const allTabs = walkTabs(doc.tabs);
  const transcriptTab = allTabs.find(tab => {
    const n = normalize(tab.tabProperties?.title ?? '');
    return n.includes('transcricao') || n.includes('transcript');
  });
  if (!transcriptTab) {
    const available = allTabs.map(t => t.tabProperties?.title ?? '(unnamed)').join(', ');
    throw new Error(`Tab "Transcrição" not found. Available: ${available}`);
  }
  return extractText(transcriptTab.documentTab?.body?.content ?? []);
}

export async function extractTranscript(fileId: string, fileName: string, fileDate: string, mimeType?: string): Promise<TranscriptResult> {
  const isDocx = mimeType === DOCX_MIME || fileName.endsWith('.docx');
  const transcript = isDocx
    ? (await extractFromDocx(fileId)).trim()
    : (await extractFromGoogleDoc(fileId)).trim();
  logger.info('Transcript extracted', { fileId, format: isDocx ? 'docx' : 'google-doc', chars: transcript.length });
  return { transcript, fileName, fileId, fileDate };
}
