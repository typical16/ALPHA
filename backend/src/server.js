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
const geminiKey = process.env.GEMINI_API_KEY;
const geminiUrl = process.env.GEMINI_API_URL; // Optional: endpoint to send Gemini requests to

// Log whether provider keys are present (do not print the keys themselves)
if (geminiKey) {
  // eslint-disable-next-line no-console
  console.log('[INFO] GEMINI_API_KEY is present (Gemini will be used if GEMINI_API_URL is set)');
} else if (openRouterKey) {
  // eslint-disable-next-line no-console
  console.log('[INFO] OPENROUTER_API_KEY is present');
} else {
  // eslint-disable-next-line no-console
  console.warn('[WARN] No AI provider API key set (GEMINI_API_KEY or OPENROUTER_API_KEY)');
}

if (!geminiKey && !openRouterKey) {
  // eslint-disable-next-line no-console
  console.warn('\n[WARN] No provider API key is set. Set GEMINI_API_KEY or OPENROUTER_API_KEY in environment variables.');
}

app.use(morgan('dev'));
app.use(cors(corsOptions));
// Payload limit for image uploads
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ limit: '3mb' }));

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
    hasGeminiKey: !!geminiKey,
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
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB base64 limit
  const allowedRoles = new Set(['user', 'assistant', 'system']);

  const trimmed = rawMessages.slice(-MAX_MESSAGES);
  const safe = [];

  for (const m of trimmed) {
    if (!m || typeof m !== 'object') continue;
    const role = allowedRoles.has(m.role) ? m.role : 'user';
    
    // Handle multimodal messages (with images)
    if (m.image && typeof m.image === 'string' && m.image.startsWith('data:image/')) {
      // Validate image size (approximate - base64 is ~33% larger than binary)
      const base64Size = m.image.length;
      if (base64Size > MAX_IMAGE_SIZE) {
        continue; // Skip if image too large
      }
      
      let textContent = m.content || '';
      if (typeof textContent !== 'string') {
        textContent = String(textContent || '');
      }
      const normalizedText = textContent.trim() || 'What\'s in this image?';
      const limitedText = normalizedText.length > MAX_CHARS ? normalizedText.slice(0, MAX_CHARS) : normalizedText;
      
      // Format for vision API
      safe.push({
        role,
        content: [
          { type: 'text', text: limitedText },
          { type: 'image_url', image_url: { url: m.image } }
        ]
      });
      continue;
    }
    
    // Handle text-only messages
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

function convertMessagesToGeminiFormat(messages) {
  // Convert OpenRouter message format to Gemini API format
  const contents = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      // Gemini doesn't have a system role; prepend to first user message
      continue;
    }
    
    const parts = [];
    
    if (Array.isArray(msg.content)) {
      // Multimodal content
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          // Convert image URL to base64 data if needed, or pass inline_data
          const url = item.image_url?.url;
          if (url && url.startsWith('data:image/')) {
            const [header, data] = url.split(',');
            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
            parts.push({
              inline_data: {
                mime_type: mimeType,
                data: data
              }
            });
          } else {
            parts.push({ text: `[Image: ${url}]` });
          }
        }
      }
    } else {
      // Text-only content
      parts.push({ text: msg.content });
    }
    
    if (parts.length > 0) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts
      });
    }
  }
  
  return contents;
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!geminiKey && !openRouterKey) {
      return res.status(500).json({ error: 'Server not configured: missing GEMINI_API_KEY or OPENROUTER_API_KEY' });
    }

    const { messages: rawMessages, model, temperature, top_p, max_tokens } = req.body || {};

    const safeMessages = sanitizeMessages(rawMessages);
    if (!Array.isArray(safeMessages) || safeMessages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: at least one non-empty user message is required' });
    }

    // Check if any message contains images (multimodal)
    const hasImages = safeMessages.some(m => 
      Array.isArray(m.content) && m.content.some(item => item?.type === 'image_url')
    );

    // Select model - use vision-capable model if images are present
    let selectedModel = typeof model === 'string' && model.trim()
      ? model.trim()
      : (hasImages ? 'openai/gpt-4o-mini' : 'openai/gpt-4o-mini');
    
    // If images are present but model doesn't support vision, switch to a vision model
    if (hasImages && !selectedModel.includes('gpt-4o') && !selectedModel.includes('gpt-4-vision') && !selectedModel.includes('claude-3')) {
      selectedModel = 'openai/gpt-4o-mini'; // Default to vision-capable model
    }

    const hasSystem = safeMessages.some(m => m?.role === 'system');
    const baseSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Alpha. If asked who created you or who built you, answer exactly: "Sarthak created me." Always refer to yourself as Alpha.';
    const suggestionInstructions = 'When you answer, always: 1) Provide the best possible answer in a clear, concise and well-organized way, using headings, bullet points and step-by-step lists when helpful. 2) Keep explanations focused and avoid unnecessary repetition. 3) After the main answer, add a short section titled "Follow-up suggestions" with 3-5 short example questions the user could ask next that are directly related to their original question.';
    const defaultSystemPrompt = `${baseSystemPrompt}\n\n${suggestionInstructions}`;
    const finalMessages = hasSystem ? safeMessages : [{ role: 'system', content: defaultSystemPrompt }, ...safeMessages];

    const safeTemperature = clampNumber(temperature, 0, 1);
    const safeTopP = clampNumber(top_p, 0, 1);
    const safeMaxTokens = clampNumber(max_tokens, 1, 4096);

    // Try Gemini first if configured, fall back to OpenRouter on any error
    let lastError = null;
    const providers = [];

    if (geminiKey && geminiUrl) {
      providers.push({
        name: 'Gemini',
        key: geminiKey,
        endpoint: geminiUrl,
        isGemini: true
      });
    }

    if (openRouterKey) {
      providers.push({
        name: 'OpenRouter',
        key: openRouterKey,
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        isGemini: false
      });
    }

    // Try each provider in order
    for (const provider of providers) {
      try {
        // eslint-disable-next-line no-console
        console.log(`[Chat Request] Attempting with ${provider.name}...`);

        // Build headers based on provider
        let headers = {
          'Content-Type': 'application/json'
        };
        
        if (provider.isGemini) {
          headers['X-goog-api-key'] = provider.key;
        } else {
          headers['Authorization'] = `Bearer ${provider.key}`;
          headers['HTTP-Referer'] = process.env.HTTP_REFERER || 'http://localhost:5173';
          headers['X-Title'] = process.env.APP_TITLE || 'Alpha';
        }

        let payload;
        
        if (provider.isGemini) {
          // Convert to Gemini API format
          const contents = convertMessagesToGeminiFormat(finalMessages);
          payload = {
            contents,
            generationConfig: {
              temperature: safeTemperature,
              topP: safeTopP,
              maxOutputTokens: safeMaxTokens,
            },
            safetySettings: [
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'BLOCK_NONE'
              },
              {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'BLOCK_NONE'
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_NONE'
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_NONE'
              }
            ]
          };
        } else {
          // OpenRouter API format
          payload = {
            model: selectedModel,
            messages: finalMessages,
            temperature: safeTemperature,
            top_p: safeTopP,
            max_tokens: safeMaxTokens,
          };
        }

        const response = await axios.post(provider.endpoint, payload, { headers, timeout: 60000 });
        const data = response.data;

        let content = '';
        let role = 'assistant';
        
        if (provider.isGemini) {
          // Extract from Gemini response format
          content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          role = 'assistant';
        } else {
          // Extract from OpenRouter response format
          content = data?.choices?.[0]?.message?.content ?? '';
          role = data?.choices?.[0]?.message?.role ?? 'assistant';
        }

        // eslint-disable-next-line no-console
        console.log(`[Chat Request] Success with ${provider.name}`);

        return res.json({ content, role, raw: { id: data?.id, model: data?.model, usage: data?.usage } });
      } catch (err) {
        lastError = err;
        const statusCode = err?.response?.status;
        // eslint-disable-next-line no-console
        console.warn(`[Chat Request] Failed with ${provider.name} (${statusCode || 'Network Error'}), trying next provider...`);
        if (err?.response?.data) {
          // eslint-disable-next-line no-console
          console.warn(`[${provider.name} Error Details]`, JSON.stringify(err.response.data).slice(0, 200));
        }
        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    const { statusCode, message } = buildClientErrorFromOpenRouter(lastError);
    // eslint-disable-next-line no-console
    console.error('[All Providers Failed]', message, lastError?.response?.status || lastError?.code || '');
    if (lastError?.response?.data) {
      // eslint-disable-next-line no-console
      console.error('[Provider Response Data]', JSON.stringify(lastError.response.data));
    }
    return res.status(statusCode).json({ error: message });
  } catch (err) {
    const { statusCode, message } = buildClientErrorFromOpenRouter(err);
    // eslint-disable-next-line no-console
    console.error('[Unexpected Error]', message, err?.response?.status || err?.code || '');
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


