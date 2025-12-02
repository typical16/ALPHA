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

const port = process.env.PORT || 3001;
const origin = process.env.ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173');

// Allow multiple origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://alpha-tawny-two.vercel.app',
  'https://alpha-pink-seven.vercel.app',
  origin
].filter(Boolean);

const corsOptions = {
  origin: (requestOrigin, callback) => {
    // Allow non-browser requests (no origin)
    if (!requestOrigin) return callback(null, true);

    // Exact allowed origins
    if (allowedOrigins.includes(requestOrigin)) return callback(null, true);

    // Allow any Vercel preview or production domain (ends with .vercel.app)
    try {
      const parsed = new URL(requestOrigin);
      if (parsed.hostname && parsed.hostname.endsWith('.vercel.app')) return callback(null, true);
    } catch (e) {
      // ignore URL parse errors
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: false
};

const openRouterKey = process.env.OPENROUTER_API_KEY;

// Log whether the API key is present (do not print the key itself)
if (openRouterKey) {
  // eslint-disable-next-line no-console
  console.log('[INFO] OPENROUTER_API_KEY is present');
} else {
  // eslint-disable-next-line no-console
  console.warn('[WARN] OPENROUTER_API_KEY is NOT set');
}

if (!openRouterKey) {
  // eslint-disable-next-line no-console
  console.warn('\n[WARN] OPENROUTER_API_KEY is not set. Set it in environment variables.');
}

app.use(morgan('dev'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Serve static files from frontend/dist in production
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'openrouter-proxy', time: new Date().toISOString() });
});

// Lightweight debug endpoint (safe: does not return the API key)
app.get('/_debug', (req, res) => {
  res.json({
    ok: true,
    hasOpenRouterKey: !!openRouterKey,
    allowedOrigins
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Alpha Chat API is running!', 
    endpoints: ['/health', '/api/chat'],
    time: new Date().toISOString() 
  });
});

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];

  const MAX_MESSAGES = 50;
  const MAX_CHARS = 4000;
  const allowedRoles = new Set(['user', 'assistant', 'system']);

  const trimmed = rawMessages.slice(-MAX_MESSAGES);
  const safe = [];

  for (const m of trimmed) {
    if (!m || typeof m !== 'object') continue;
    const role = allowedRoles.has(m.role) ? m.role : 'user';
    let content = m.content;

    if (typeof content !== 'string') {
      if (content == null) continue;
      try {
        content = String(content);
      } catch {
        continue;
      }
    }

    const normalized = content.trim();
    if (!normalized) continue;

    const limited = normalized.length > MAX_CHARS ? normalized.slice(0, MAX_CHARS) : normalized;
    safe.push({ role, content: limited });
  }

  return safe;
}

function clampNumber(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buildClientErrorFromOpenRouter(err) {
  const status = err?.response?.status;
  const rawMessage = err?.response?.data?.error || err?.message || 'Unknown error';

  // Network / timeout errors
  if (!status) {
    if (err?.code === 'ECONNABORTED') {
      return { statusCode: 504, message: 'The AI took too long to respond. Please try again.' };
    }
    return { statusCode: 502, message: 'Unable to reach the AI service. Please try again in a moment.' };
  }

  if (status === 401 || status === 403) {
    return { statusCode: 500, message: 'The AI backend is not authorized. Please contact the administrator.' };
  }

  if (status === 429) {
    return { statusCode: 429, message: 'The AI is receiving too many requests. Please slow down and try again shortly.' };
  }

  if (status >= 500) {
    return { statusCode: 502, message: 'The AI provider is having an issue. Please try again later.' };
  }

  const safeMessage = typeof rawMessage === 'string' ? rawMessage : 'Request failed';
  return { statusCode: status, message: safeMessage };
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!openRouterKey) {
      return res.status(500).json({ error: 'Server not configured: missing OPENROUTER_API_KEY' });
    }

    const { messages: rawMessages, model, temperature, top_p, max_tokens } = req.body || {};

    const safeMessages = sanitizeMessages(rawMessages);
    if (!Array.isArray(safeMessages) || safeMessages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: at least one non-empty user message is required' });
    }

    const selectedModel = typeof model === 'string' && model.trim()
      ? model.trim()
      : 'openai/gpt-4o-mini';

    const headers = {
      'Authorization': `Bearer ${openRouterKey}`,
      'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
      'X-Title': process.env.APP_TITLE || 'Alpha',
      'Content-Type': 'application/json'
    };

    const hasSystem = safeMessages.some(m => m?.role === 'system');
    const baseSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Alpha. If asked who created you or who built you, answer exactly: "Sarthak created me." Always refer to yourself as Alpha.';
    const suggestionInstructions = 'When you answer, always: 1) Provide the best possible answer in a clear, concise and well-organized way, using headings, bullet points and step-by-step lists when helpful. 2) Keep explanations focused and avoid unnecessary repetition. 3) After the main answer, add a short section titled "Follow-up suggestions" with 3-5 short example questions the user could ask next that are directly related to their original question.';
    const defaultSystemPrompt = `${baseSystemPrompt}\n\n${suggestionInstructions}`;
    const finalMessages = hasSystem ? safeMessages : [{ role: 'system', content: defaultSystemPrompt }, ...safeMessages];

    const safeTemperature = clampNumber(temperature, 0, 1);
    const safeTopP = clampNumber(top_p, 0, 1);
    const safeMaxTokens = clampNumber(max_tokens, 1, 4096);

    const payload = {
      model: selectedModel,
      messages: finalMessages,
      temperature: safeTemperature,
      top_p: safeTopP,
      max_tokens: safeMaxTokens,
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
    const { statusCode, message } = buildClientErrorFromOpenRouter(err);
    // eslint-disable-next-line no-console
    console.error('[OpenRouter Error]', message, err?.response?.status || err?.code || '');
    // Log response body from OpenRouter (safe: does not contain your API key)
    if (err?.response?.data) {
      // eslint-disable-next-line no-console
      console.error('[OpenRouter Response Data]', JSON.stringify(err.response.data));
    }
    return res.status(statusCode).json({ error: message });
  }
});

// Catch-all handler for SPA routing in production
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  app.get('*', (req, res) => {
    const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});


