import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load env from backend/.env regardless of CWD
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

const port = process.env.PORT || 3002;
const origin = process.env.ORIGIN || 'http://localhost:5173';
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!openRouterKey) {
  // eslint-disable-next-line no-console
  console.warn('\n[WARN] OPENROUTER_API_KEY is not set. Set it in backend/.env before starting the server.');
}

app.use(morgan('dev'));
app.use(cors({ origin, credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'openrouter-proxy', time: new Date().toISOString() });
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!openRouterKey) {
      return res.status(500).json({ error: 'Server not configured: missing OPENROUTER_API_KEY' });
    }

    const { messages, model, temperature, top_p, max_tokens } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: messages array is required' });
    }

    const selectedModel = model || 'openai/gpt-4o-mini';

    const headers = {
      'Authorization': `Bearer ${openRouterKey}`,
      'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
'X-Title': process.env.APP_TITLE || 'Alpha',
      'Content-Type': 'application/json'
    };

    const hasSystem = Array.isArray(messages) && messages.some(m => m?.role === 'system');
    const defaultSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Alpha. If asked who created you or who built you, answer exactly: "Sarthak created me." Always refer to yourself as Alpha.';
    const finalMessages = hasSystem ? messages : [{ role: 'system', content: defaultSystemPrompt }, ...messages];

    const payload = {
      model: selectedModel,
      messages: finalMessages,
      temperature: typeof temperature === 'number' ? temperature : undefined,
      top_p: typeof top_p === 'number' ? top_p : undefined,
      max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
    };

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      payload,
      { headers, timeout: 60000 }
    );

    const data = response.data;

    const content = data?.choices?.[0]?.message?.content ?? '';
    const role = data?.choices?.[0]?.message?.role ?? 'assistant';

    return res.json({ content, role, raw: { id: data?.id, model: data?.model, usage: data?.usage } });
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.error || err?.message || 'Unknown error';
    // eslint-disable-next-line no-console
    console.error('[OpenRouter Error]', message);
    return res.status(status).json({ error: typeof message === 'string' ? message : 'Request failed' });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});


