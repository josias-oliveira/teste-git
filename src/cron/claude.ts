import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface ClaudeResult {
  summary: string;
  tasks: Array<{
    title: string; description: string;
    assignee: string | null;
    priority: 'Alta' | 'Média' | 'Baixa';
    dueDate: string | null;
  }>;
}

const SYSTEM_PROMPT = "Você responde EXCLUSIVAMENTE com JSON cru. Nunca use ```json, nunca use ```, nunca escreva texto antes ou depois do objeto. A primeira caractere da sua resposta deve ser '{' e o último deve ser '}'.";

function buildUserPrompt(transcript: string): string {
  return `Você é um assistente especialista em análise de reuniões comerciais e de produto.

Abaixo está a transcrição completa de uma call:

<transcript>
${transcript}
</transcript>

Sua tarefa:
1. Leia a transcrição inteira com atenção.
2. Identifique todas as ações/tarefas (tasks) acionáveis que foram acordadas ou sugeridas.
3. Para cada task, extraia: título curto (máx. 80 chars), descrição (contexto da call), responsável (se citado), prioridade (Alta/Média/Baixa), prazo se mencionado (ISO 8601 ou null).
4. Gere também um resumo executivo da call (máx. 5 linhas).

Retorne APENAS o objeto JSON cru, sem crases, sem blocos de código, sem a palavra 'json', sem explicações antes ou depois. Comece a resposta com '{' e termine com '}'.

Formato:
{
  "summary": "...",
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "assignee": "..." ou null,
      "priority": "Alta" ou "Média" ou "Baixa",
      "dueDate": "YYYY-MM-DD" ou null
    }
  ]
}`;
}

function parseOutput(raw: string): ClaudeResult {
  let text = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON found. Raw: ${raw.slice(0, 500)}`);
  text = text.slice(start, end + 1);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.tasks)) {
    throw new Error(`Unexpected JSON shape. Keys: ${Object.keys(parsed).join(', ')}`);
  }
  return parsed as unknown as ClaudeResult;
}

async function callAnthropic(transcript: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.ai.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 4096, temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(transcript) }],
  });
  return (response.content[0] as { type: string; text: string }).text;
}

async function callGoogle(transcript: string): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genai = new GoogleGenerativeAI(config.ai.googleAiApiKey!);
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: SYSTEM_PROMPT });
  const result = await model.generateContent(buildUserPrompt(transcript));
  return result.response.text();
}

export async function analyzeTranscript(transcript: string): Promise<ClaudeResult> {
  const provider = config.ai.provider;
  logger.info('Chamando AI', { provider });
  const raw = provider === 'google' ? await callGoogle(transcript) : await callAnthropic(transcript);
  const result = parseOutput(raw);
  logger.info('AI analysis complete', { provider, tasks: result.tasks.length });
  return result;
}
