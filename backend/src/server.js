import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';

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
  'http://localhost',
  'capacitor://localhost',
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
    callback(null, true); // Fallback: allow for mobile apps
  },
  credentials: false
};

// ── Logging: production-appropriate format ──────────────
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
app.use(morgan(isProduction ? 'combined' : 'dev', {
  // Skip health check pings in production to reduce log noise
  skip: (req) => isProduction && req.path === '/health'
}));

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ limit: '3mb' }));

// ── Rate limiting ───────────────────────────────────────
// Global limiter: 200 req/min per IP (covers all routes)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' }
});
app.use(globalLimiter);

// Tighter chat-specific limiter: 20 req/min per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
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

// ── Static files (production) with ETag + caching ──────
if (isProduction) {
  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath, {
    etag: true,
    maxAge: '1d',
    immutable: true,
    lastModified: true
  }));
}

// ── Routes ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  // Cache health response to reduce load from many polling clients
  res.set('Cache-Control', 'public, max-age=5');
  res.set('Connection', 'keep-alive');
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

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
        'X-Title': process.env.APP_TITLE || 'Alpha',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw { response: { status: response.status, data: { error: errData.error || `Request failed with status ${response.status}` } } };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const role = data?.choices?.[0]?.message?.role ?? 'assistant';

    return res.json({ content, role, raw: { id: data?.id, model: data?.model, usage: data?.usage } });
  } catch (err) {
    const { statusCode, message } = buildClientError(err);
    console.error('[Chat Error]', message, err?.response?.status || err?.code || '');
    return res.status(statusCode).json({ error: message });
  }
});

// ── Streaming Chat endpoint (SSE) — uses native fetch for true streaming ──
app.post('/api/chat/stream', chatLimiter, async (req, res) => {
  // Route-level safety timeout (90s)
  res.setTimeout(90_000, () => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'Request timed out' })}\n\n`);
      res.end();
    }
  });

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

    // Use native fetch for true streaming (no axios buffering)
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.HTTP_REFERER || 'http://localhost:5173',
        'X-Title': process.env.APP_TITLE || 'Alpha',
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!orRes.ok) {
      const errData = await orRes.json().catch(() => ({}));
      throw { response: { status: orRes.status, data: { error: errData.error || `Upstream error ${orRes.status}` } } };
    }

    // Stream the response body through to the client
    const reader = orRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

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
      }
    } finally {
      reader.releaseLock();
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    if (err?.name === 'AbortError') {
      // Client disconnected, nothing to do
      if (!res.writableEnded) res.end();
      return;
    }
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
if (isProduction) {
  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  // SPA catch-all: serve index.html for any unmatched route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
