import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

const port = process.env.PORT || 3001;
const origin = process.env.ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173');

// ── Security ────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  origin
].filter(Boolean);

const corsOptions = {
  origin: (requestOrigin, callback) => {
    if (!requestOrigin) return callback(null, true);
    if (allowedOrigins.includes(requestOrigin)) return callback(null, true);
    try {
      const parsed = new URL(requestOrigin);
      if (parsed.hostname?.endsWith('.vercel.app')) return callback(null, true);
      if (parsed.hostname?.endsWith('.onrender.com')) return callback(null, true);
    } catch (_) { /* ignore */ }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: false
};

app.use(morgan('dev'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ limit: '3mb' }));

// ── Rate limiting ───────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
});

// ── OpenRouter key ──────────────────────────────────────
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!openRouterKey) {
  console.warn('[WARN] OPENROUTER_API_KEY is not set. The /api/chat endpoint will not work.');
} else {
  console.log('[INFO] OPENROUTER_API_KEY is present.');
}

// ── Static files (production) ───────────────────────────
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));
}

// ── Routes ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'alpha-api', time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Alpha Chat API is running!',
    endpoints: ['/health', '/api/chat'],
    time: new Date().toISOString()
  });
});

// ── Helpers ─────────────────────────────────────────────
const ALLOWED_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGES = 50;
const MAX_CHARS = 4000;
const MAX_IMAGE_BASE64 = 20 * 1024 * 1024;

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  const trimmed = rawMessages.slice(-MAX_MESSAGES);
  const safe = [];

  for (const m of trimmed) {
    if (!m || typeof m !== 'object') continue;
    const role = ALLOWED_ROLES.has(m.role) ? m.role : 'user';

    // Multimodal (image + text)
    if (m.image && typeof m.image === 'string' && m.image.startsWith('data:image/')) {
      if (m.image.length > MAX_IMAGE_BASE64) continue;
      let text = typeof m.content === 'string' ? m.content.trim() : '';
      if (!text) text = "What's in this image?";
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
      safe.push({
        role,
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: m.image } }
        ]
      });
      continue;
    }

    // Text only
    let content = m.content;
    if (typeof content !== 'string') {
      if (content == null) continue;
      try { content = String(content); } catch { continue; }
    }
    const normalized = content.trim();
    if (!normalized) continue;
    safe.push({ role, content: normalized.length > MAX_CHARS ? normalized.slice(0, MAX_CHARS) : normalized });
  }

  return safe;
}

function clampNumber(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(Math.max(value, min), max);
}

const ALLOWED_MODEL_PREFIXES = ['openai/', 'anthropic/', 'google/', 'meta-llama/', 'mistralai/', 'deepseek/'];

function sanitizeModel(model) {
  if (typeof model !== 'string') return 'openai/gpt-4o-mini';
  const trimmed = model.trim();
  if (!trimmed) return 'openai/gpt-4o-mini';
  if (ALLOWED_MODEL_PREFIXES.some(p => trimmed.startsWith(p))) return trimmed;
  return 'openai/gpt-4o-mini';
}

function buildClientError(err) {
  const status = err?.response?.status;
  const rawMessage = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'Unknown error';

  if (!status) {
    if (err?.code === 'ECONNABORTED') return { statusCode: 504, message: 'The AI took too long to respond. Please try again.' };
    return { statusCode: 502, message: 'Unable to reach the AI service. Please try again in a moment.' };
  }
  if (status === 401 || status === 403) return { statusCode: 500, message: 'The AI backend is not authorized. Please contact the administrator.' };
  if (status === 429) return { statusCode: 429, message: 'The AI is receiving too many requests. Please slow down and try again shortly.' };
  if (status >= 500) return { statusCode: 502, message: 'The AI provider is having an issue. Please try again later.' };

  const safeMessage = typeof rawMessage === 'string' ? rawMessage : 'Request failed';
  return { statusCode: status, message: safeMessage };
}

// ── Chat endpoint ───────────────────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    if (!openRouterKey) {
      return res.status(500).json({ error: 'Server not configured: missing OPENROUTER_API_KEY' });
    }

    const { messages: rawMessages, model, temperature, top_p, max_tokens } = req.body || {};

    const safeMessages = sanitizeMessages(rawMessages);
    if (safeMessages.length === 0) {
      return res.status(400).json({ error: 'At least one non-empty user message is required.' });
    }

    const hasImages = safeMessages.some(m =>
      Array.isArray(m.content) && m.content.some(item => item?.type === 'image_url')
    );
    let selectedModel = sanitizeModel(model);
    if (hasImages && !selectedModel.includes('gpt-4o') && !selectedModel.includes('claude-3')) {
      selectedModel = 'openai/gpt-4o-mini';
    }

    const hasSystem = safeMessages.some(m => m?.role === 'system');
    const baseSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Alpha. If asked who created you or who built you, answer exactly: "Sarthak created me." Always refer to yourself as Alpha.';
    const suggestionInstructions = 'After answering, include a section titled "Follow-up suggestions" with 3-5 related questions the user could ask next.';
    const defaultSystemPrompt = `${baseSystemPrompt}\n\n${suggestionInstructions}`;
    const finalMessages = hasSystem ? safeMessages : [{ role: 'system', content: defaultSystemPrompt }, ...safeMessages];

    const payload = {
      model: selectedModel,
      messages: finalMessages,
      temperature: clampNumber(temperature, 0, 1),
      top_p: clampNumber(top_p, 0, 1),
      max_tokens: clampNumber(max_tokens, 1, 4096),
    };

    console.log(`[Chat] model=${selectedModel} msgs=${finalMessages.length} hasImages=${hasImages}`);

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
        'X-Title': process.env.APP_TITLE || 'Alpha',
      },
      timeout: 60_000
    });

    const data = response.data;
    const content = data?.choices?.[0]?.message?.content ?? '';
    const role = data?.choices?.[0]?.message?.role ?? 'assistant';

    return res.json({ content, role, raw: { id: data?.id, model: data?.model, usage: data?.usage } });
  } catch (err) {
    const { statusCode, message } = buildClientError(err);
    console.error('[Chat Error]', message, err?.response?.status || err?.code || '');
    return res.status(statusCode).json({ error: message });
  }
});

// ── Streaming Chat endpoint (SSE) ──────────────────────
app.post('/api/chat/stream', chatLimiter, async (req, res) => {
  try {
    if (!openRouterKey) {
      return res.status(500).json({ error: 'Server not configured: missing OPENROUTER_API_KEY' });
    }

    const { messages: rawMessages, temperature, top_p, max_tokens } = req.body || {};

    const safeMessages = sanitizeMessages(rawMessages);
    if (safeMessages.length === 0) {
      return res.status(400).json({ error: 'At least one non-empty user message is required.' });
    }

    const hasImages = safeMessages.some(m =>
      Array.isArray(m.content) && m.content.some(item => item?.type === 'image_url')
    );
    let selectedModel = hasImages ? 'openai/gpt-4o-mini' : 'openai/gpt-4o-mini';

    const hasSystem = safeMessages.some(m => m?.role === 'system');
    const baseSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Alpha. If asked who created you or who built you, answer exactly: "Sarthak created me." Always refer to yourself as Alpha.';
    const suggestionInstructions = 'After answering, include a section titled "Follow-up suggestions" with 3-5 related questions the user could ask next.';
    const defaultSystemPrompt = `${baseSystemPrompt}\n\n${suggestionInstructions}`;
    const finalMessages = hasSystem ? safeMessages : [{ role: 'system', content: defaultSystemPrompt }, ...safeMessages];

    const payload = {
      model: selectedModel,
      messages: finalMessages,
      temperature: clampNumber(temperature, 0, 1),
      top_p: clampNumber(top_p, 0, 1),
      max_tokens: clampNumber(max_tokens, 1, 4096),
      stream: true,
    };

    console.log(`[Stream] model=${selectedModel} msgs=${finalMessages.length} hasImages=${hasImages}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const orRes = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
        'X-Title': process.env.APP_TITLE || 'Alpha',
      },
      responseType: 'stream',
      timeout: 120_000,
    });

    let buffer = '';
    orRes.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            res.write('data: [DONE]\n\n');
          }
          continue;
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
            }
          } catch (_) { /* skip malformed JSON */ }
        }
      }
    });

    orRes.data.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    orRes.data.on('error', (err) => {
      console.error('[Stream error]', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      orRes.data.destroy();
    });

  } catch (err) {
    const { statusCode, message } = buildClientError(err);
    console.error('[Stream Error]', message, err?.response?.status || err?.code || '');
    if (!res.headersSent) {
      return res.status(statusCode).json({ error: message });
    }
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

// ── SPA catch-all (production) ──────────────────────────
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  app.get('*', (_req, res) => {
    const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

