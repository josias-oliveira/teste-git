import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export type AiProvider = 'anthropic' | 'google';

interface Config {
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    driveFolderId: string;
  };
  ai: {
    provider: AiProvider;
    anthropicApiKey?: string;
    googleAiApiKey?: string;
  };
  notion: {
    token: string;
    meetingRecordingsDbId: string;
    tarefasDbId: string;
  };
  app: {
    port: number;
    cronSecret: string;
    nodeEnv: 'development' | 'production';
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const provider = (process.env.AI_PROVIDER ?? 'google') as AiProvider;

if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
}
if (provider === 'google' && !process.env.GOOGLE_AI_API_KEY) {
  throw new Error('AI_PROVIDER=google requires GOOGLE_AI_API_KEY');
}

export const config: Config = {
  google: {
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refreshToken: requireEnv('GOOGLE_REFRESH_TOKEN'),
    driveFolderId: requireEnv('GOOGLE_DRIVE_FOLDER_ID'),
  },
  ai: {
    provider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY,
  },
  notion: {
    token: requireEnv('NOTION_TOKEN'),
    meetingRecordingsDbId: requireEnv('NOTION_MEETING_RECORDINGS_DB_ID'),
    tarefasDbId: requireEnv('NOTION_TAREFAS_DB_ID'),
  },
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    cronSecret: requireEnv('CRON_SECRET'),
    nodeEnv: (process.env.NODE_ENV as 'development' | 'production') ?? 'development',
  },
};
