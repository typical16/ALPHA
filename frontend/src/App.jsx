import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import imageCompression from 'browser-image-compression'
import 'katex/dist/katex.min.css'

// API_BASE_URL: empty string → Vite proxy handles /api/* → localhost:3001
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

/** Normalize LaTeX delimiters so remark-math can render */
function normalizeMathDelimiters(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
}

const LOCAL_STORAGE_SESSIONS = 'alpha_sessions_v1'
const LOCAL_STORAGE_OLD = 'openrouter_chat_history_v1'
const LOCAL_STORAGE_SETTINGS = 'openrouter_chat_settings_v1'
const MAX_INPUT_CHARS = 4000

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6)
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SESSIONS)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
    // Migrate old flat array format if exists
    const oldRaw = localStorage.getItem(LOCAL_STORAGE_OLD)
    if (oldRaw) {
      const parsed = JSON.parse(oldRaw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migratedSession = {
          id: generateId(),
          title: parsed.find(m => m.role === 'user')?.content?.slice(0, 30) || 'Imported Chat',
          updatedAt: Date.now(),
          messages: parsed.map(m => ({ ...m, isTyping: false }))
        }
        return [migratedSession]
      }
    }
    return []
  } catch {
    return []
  }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(LOCAL_STORAGE_SESSIONS, JSON.stringify(sessions))
  } catch { }
}

function extractFollowUpSuggestions(content) {
  if (!content || typeof content !== 'string') return []
  const lines = content.split('\n')
  const suggestions = []
  const startIndex = lines.findIndex(line => {
    const t = line.trim().toLowerCase()
    return t === 'follow-up suggestions:' || t === 'follow-up suggestions' || t.startsWith('### follow-up suggestions')
  })
  if (startIndex === -1) return []
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('#') && !line.toLowerCase().startsWith('### follow-up suggestions')) {
      if (suggestions.length > 0) break
      continue
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)$/)
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/)
    const text = (bulletMatch && bulletMatch[1]) || (numberedMatch && numberedMatch[1]) || null
    if (text) {
      suggestions.push(text.trim())
      if (suggestions.length >= 5) break
    } else if (suggestions.length > 0) {
      break
    }
  }
  return suggestions
}

// ── Copy Toast ────────────────────────────────────────────
function CopyToast({ visible }) {
  return (
    <div className={`copy-toast ${visible ? 'copy-toast-visible' : ''}`} aria-live="polite">
      ✓ Copied!
    </div>
  )
}

// ── Error Boundary ────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center z-10 relative">
          <div className="text-5xl drop-shadow-lg">⚠️</div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Something went wrong</h2>
          <p className="text-stone-400 text-sm max-w-sm">{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-5 py-2.5 rounded-xl glass-button text-white text-sm font-medium shadow-glow hover:shadow-lg transition-all"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Intro Screen ──────────────────────────────────────────
function AlphaIntro({ onClose }) {
  const [animationStage, setAnimationStage] = useState(0)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const t1 = setTimeout(() => setAnimationStage(1), 200)
    const t2 = setTimeout(() => setAnimationStage(2), 1000)
    const t3 = setTimeout(() => setAnimationStage(3), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      setMousePos({ x: (e.clientX - cx) / cx * 15, y: (e.clientY - cy) / cy * 15 })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const letters = ['A', 'L', 'P', 'H', 'A']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/10 animate-float"
            style={{
              left: `${(i * 5.13) % 100}%`,
              top: `${(i * 7.37) % 100}%`,
              width: `${(i % 4) + 2}px`,
              height: `${(i % 4) + 2}px`,
              animationDelay: `${(i % 3)}s`,
              animationDuration: `${(i % 3) + 2}s`
            }}
          />
        ))}
      </div>

      <div className="text-center relative z-10">
        <div
          className="relative mb-8"
          style={{ perspective: '1200px', perspectiveOrigin: 'center center', transformStyle: 'preserve-3d' }}
        >
          <div
            className="alpha-logo-3d-container"
            style={{
              transformStyle: 'preserve-3d',
              transform: animationStage >= 1
                ? `rotateY(${mousePos.x + (animationStage >= 2 ? 5 : 0)}deg) rotateX(${-mousePos.y + (animationStage >= 2 ? 2 : 0)}deg)`
                : 'rotateY(0deg) rotateX(0deg)',
              transition: animationStage >= 1 ? 'transform 0.15s ease-out' : 'none',
            }}
          >
            <div className="flex items-center justify-center gap-2 md:gap-4">
              {letters.map((letter, index) => (
                <div
                  key={index}
                  className="alpha-3d-letter"
                  style={{
                    transformStyle: 'preserve-3d',
                    animation: animationStage >= 1
                      ? `letterFlip 0.8s ease-out ${index * 0.1}s both, letterFloat 3s ease-in-out ${index * 0.2}s infinite`
                      : 'none',
                    animationFillMode: 'both'
                  }}
                >
                  {[
                    { transform: 'translateZ(50px)', cls: 'alpha-letter-front' },
                    { transform: 'rotateY(180deg) translateZ(50px)', cls: 'alpha-letter-back' },
                    { transform: 'rotateX(90deg) translateZ(50px)', cls: 'alpha-letter-top' },
                    { transform: 'rotateX(-90deg) translateZ(50px)', cls: 'alpha-letter-bottom' },
                    { transform: 'rotateY(90deg) translateZ(50px)', cls: 'alpha-letter-right' },
                    { transform: 'rotateY(-90deg) translateZ(50px)', cls: 'alpha-letter-left' },
                  ].map(({ transform, cls }) => (
                    <div
                      key={cls}
                      className={`alpha-letter-face ${cls}`}
                      style={{ transform }}
                    >
                      <span style={{
                        background: 'linear-gradient(135deg, #00F0FF 0%, #7000FF 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        filter: 'drop-shadow(0 0 15px rgba(0,240,255,0.6))',
                      }}>{letter}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div
            className={`absolute inset-0 blur-3xl transition-opacity duration-1000 ${animationStage >= 2 ? 'opacity-60' : 'opacity-0'}`}
            style={{
              background: 'radial-gradient(circle, rgba(0,240,255,0.4) 0%, rgba(112,0,255,0.4) 100%)',
              transform: 'translateZ(-100px) scale(1.5)',
              animation: animationStage >= 2 ? 'pulseGlow 2s ease-in-out infinite' : 'none'
            }}
          />
        </div>

        <p className={`text-xl md:text-2xl text-white/90 font-light transition-all duration-700 delay-500 ${animationStage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          Your intelligent AI assistant
        </p>

        <button
          onClick={onClose}
          aria-label="Get started with Alpha"
          className={`mt-8 px-8 py-3 rounded-xl bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/20 transition-all duration-300 shadow-lg hover:shadow-xl font-medium ${animationStage >= 3 ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
        >
          Get Started →
        </button>
      </div>
    </div>
  )
}

// ── Image Compression ─────────────────────────────────────
async function compressImageToBase64(file) {
  const compressionStages = [
    { maxSizeMB: 0.25, maxWidthOrHeight: 900, useWebWorker: true, fileType: 'image/jpeg', initialQuality: 0.55 },
    { maxSizeMB: 0.12, maxWidthOrHeight: 600, useWebWorker: true, fileType: 'image/jpeg', initialQuality: 0.35 },
    { maxSizeMB: 0.05, maxWidthOrHeight: 400, useWebWorker: true, fileType: 'image/jpeg', initialQuality: 0.25 },
  ]
  const sizeLimits = [1_000_000, 600_000, Infinity]

  for (let i = 0; i < compressionStages.length; i++) {
    const compressed = await imageCompression(file, compressionStages[i])
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target.result)
      reader.onerror = () => reject(new Error('Failed to read image file'))
      reader.readAsDataURL(compressed)
    })
    if (base64.length <= sizeLimits[i]) return base64
  }
  throw new Error('Image could not be compressed to an acceptable size')
}

function triggerHaptic(pattern) {
  try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern) } catch {}
}

const MarkdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const language = match ? match[1] : ''
    
    if (!inline) {
      return (
        <div className="rounded-xl overflow-hidden my-4 border border-[var(--border-glass)] shadow-lg bg-[#0B0E14] code-block-premium">
          <div className="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-[var(--border-glass)]">
            <div className="flex gap-1.5 items-center">
              <div className="w-3 h-3 rounded-full bg-[#FF5F56] shadow-[0_0_5px_rgba(255,95,86,0.3)]" />
              <div className="w-3 h-3 rounded-full bg-[#FFBD2E] shadow-[0_0_5px_rgba(255,189,46,0.3)]" />
              <div className="w-3 h-3 rounded-full bg-[#27C93F] shadow-[0_0_5px_rgba(39,201,63,0.3)]" />
            </div>
            {language && <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">{language}</div>}
            <button
              onClick={(e) => {
                const btn = e.currentTarget
                try {
                  navigator.clipboard.writeText(String(children).replace(/\n$/, ''))
                  triggerHaptic(15)
                  btn.textContent = "Copied!"
                  btn.classList.add("text-[#00F0FF]")
                  setTimeout(() => {
                    btn.textContent = "Copy"
                    btn.classList.remove("text-[#00F0FF]")
                  }, 2000)
                } catch {}
              }}
              className="text-xs font-medium text-stone-400 hover:text-white transition-colors cursor-pointer"
              title="Copy code"
            >
              Copy
            </button>
          </div>
          <div className="p-4 overflow-x-auto text-[13px] leading-relaxed">
            <code className={className} {...props}>
              {children}
            </code>
          </div>
        </div>
      )
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }
}

// ── Streaming message display ─────────────────────────────
// Shows content as it streams in, with a blinking cursor
function StreamingContent({ content, done }) {
  return (
    <div className={`streaming-response ${!done ? 'glow-pulse' : ''}`}>
      <div className="prose max-w-none min-w-0 overflow-hidden prose-a:text-[#00F0FF] prose-strong:text-[var(--text-primary)] prose-code:bg-black/10 prose-code:px-1 prose-code:py-0.5 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-1 prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-[''] prose-code:after:content-[''] text-sm markdown-math text-[var(--text-primary)]">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={MarkdownComponents}>
          {normalizeMathDelimiters(content)}
        </ReactMarkdown>
      </div>
      {!done && <span className="typing-cursor" aria-hidden>|</span>}
    </div>
  )
}

// ── Message Bubble (memoized) ─────────────────────────────
const MessageBubble = memo(function MessageBubble({ role, content, time, image, isStreaming, streamDone }) {
  const isUser = role === 'user'
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied'

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopyState('copied')
      triggerHaptic(15)
      setTimeout(() => setCopyState('idle'), 2000)
    } catch { }
  }, [content])

  return (
    <div className={`${isUser ? 'flex justify-end' : 'flex justify-start'} msg-slide-in`} style={{ minWidth: 0 }}>
      <div className="flex max-w-[90%] md:max-w-[75%] min-w-0 gap-3 items-start">
        {!isUser && (
          <div
            aria-label="Alpha AI"
            className="avatar-pop flex h-7 w-7 md:h-9 md:w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#00F0FF] to-[#7000FF] text-white shrink-0 text-[10px] md:text-xs font-bold shadow-glow"
          >
            AI
          </div>
        )}
        <div className={
          'px-4 py-3.5 md:px-5 md:py-4 relative group min-w-0 overflow-hidden leading-relaxed ' +
          (isUser
            ? 'user-bubble rounded-[22px] rounded-tr-[4px] md:rounded-tr-[6px]'
            : 'ai-bubble glass-panel rounded-[22px] rounded-tl-[4px] md:rounded-tl-[6px]')
        }>
          {image && (
            <div className="mb-3 rounded-xl overflow-hidden max-w-sm border border-white/20">
              <img src={image} alt="User uploaded" className="w-full h-auto max-h-64 object-contain" />
            </div>
          )}
          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white">{content}</div>
          ) : isStreaming ? (
            <StreamingContent content={content} done={streamDone} />
          ) : (
            <div className="prose max-w-none min-w-0 overflow-hidden prose-a:text-[#00F0FF] prose-strong:text-[var(--text-primary)] prose-code:bg-black/10 prose-code:px-1 prose-code:py-0.5 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-1 prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-[''] prose-code:after:content-[''] text-sm markdown-math text-[var(--text-primary)]">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={MarkdownComponents}>
                {normalizeMathDelimiters(content)}
              </ReactMarkdown>
            </div>
          )}
          {/* Copy button — visible on hover for assistant messages */}
          {!isUser && !isStreaming && (
            <button
              onClick={copyText}
              aria-label="Copy message"
              title="Copy"
              className={`copy-btn opacity-0 group-hover:opacity-100 transition-all absolute -top-2 -right-2 text-xs rounded-lg px-2 py-1 shadow-md ${copyState === 'copied' ? 'bg-[#00F0FF] text-black font-bold opacity-100' : 'glass-button text-white'}`}
            >
              {copyState === 'copied' ? '✓ Copied!' : 'Copy'}
            </button>
          )}
          <div className={(isUser ? 'text-white/70' : 'text-stone-400') + ' text-[10px] mt-1.5 select-none'}>
            {time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </div>
        </div>
        {isUser && (
          <div
            aria-label="You"
            className="avatar-pop flex h-7 w-7 md:h-9 md:w-9 items-center justify-center rounded-full bg-gradient-to-br from-stone-600 to-stone-800 text-white shrink-0 text-[10px] md:text-xs font-bold shadow-soft border border-stone-500/30"
          >
            U
          </div>
        )}
      </div>
    </div>
  )
})

// ── Thinking shimmer (better loading indicator) ───────────
function ThinkingBubble() {
  return (
    <div className="flex justify-start msg-slide-in">
      <div className="flex gap-3 items-start">
        <div className="avatar-pop flex h-7 w-7 md:h-9 md:w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#00F0FF] to-[#7000FF] text-white shrink-0 text-[10px] md:text-xs font-bold shadow-glow">
          AI
        </div>
        <div className="ai-bubble glass-panel max-w-[85%] rounded-[22px] rounded-tl-[4px] md:rounded-tl-[6px] px-4 py-3.5 md:px-5 md:py-4">
          <div className="alpha-processing" aria-label="Alpha is thinking">
            <div className="alpha-core-container">
              <div className="alpha-orbit-2" />
              <div className="alpha-orbit-1" />
              <div className="alpha-core" />
            </div>
            <div className="alpha-processing-text">PROCESSING</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Scroll to Bottom FAB ──────────────────────────────────
function ScrollToBottomFAB({ visible, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Scroll to bottom"
      className={`scroll-fab ${visible ? 'scroll-fab-visible' : ''}`}
    >
      ↓
    </button>
  )
}

// ── Starter prompts for clickable empty-state cards ───────
const STARTER_PROMPTS = {
  'Ask anything': 'What are the most fascinating things happening in science right now?',
  'Analyze images': 'I\'ll attach an image — can you describe what you see in detail?',
  'Write code': 'Write a Python function that checks if a number is prime, with explanation.',
  'Draft content': 'Write a professional email requesting a meeting with a new client.',
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [{ initSessions, initId, initMsgs }] = useState(() => {
    const s = loadSessions()
    const id = s.length > 0 ? s[0].id : generateId()
    const msgs = s.length > 0 ? (s[0].messages || []) : []
    return { initSessions: s, initId: id, initMsgs: msgs }
  })
  
  const [sessions, setSessions] = useState(initSessions)
  const [currentSessionId, setCurrentSessionId] = useState(initId)
  const [messages, setMessages] = useState(initMsgs)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('alpha_theme')
      if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [attachedImage, setAttachedImage] = useState(null)
  const [compressingImage, setCompressingImage] = useState(false)
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem('alpha_has_seen_intro'))
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_SETTINGS)
      if (!raw) return { temperature: 0.7 }
      const parsed = JSON.parse(raw)
      return { temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.7 }
    } catch {
      return { temperature: 0.7 }
    }
  })
  const [isDragOver, setIsDragOver] = useState(false)
  const [showScrollFAB, setShowScrollFAB] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)
  const recognitionRef = useRef(null)
  const [healthy, setHealthy] = useState(null)

  // Sync theme class to root
  useEffect(() => {
    try { localStorage.setItem('alpha_theme', theme) } catch { }
    if (theme === 'light') {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
  }, [theme])

  // Sync current messages to sessions array
  useEffect(() => {
    setSessions(prev => {
      let isNew = true
      let updated = prev.map(s => {
        if (s.id === currentSessionId) {
          isNew = false
          return {
            ...s,
            messages,
            updatedAt: Date.now(),
            title: s.title === 'New Chat' || !s.title ? (messages.find(m => m.role === 'user')?.content?.slice(0, 30) || 'New Chat') : s.title
          }
        }
        return s
      })
      
      if (isNew && messages.length > 0) {
        updated = [{
          id: currentSessionId,
          title: messages.find(m => m.role === 'user')?.content?.slice(0, 30) || 'New Chat',
          updatedAt: Date.now(),
          messages
        }, ...prev]
      }
      return updated
    })
  }, [messages, currentSessionId])

  // Persist sessions to disk
  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])
  useEffect(() => {
    try { localStorage.setItem(LOCAL_STORAGE_SETTINGS, JSON.stringify(settings)) } catch { }
  }, [settings])

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior })
  }, [])

  // Auto-scroll on new messages/loading
  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  // Scroll FAB visibility
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (!el) return
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          setShowScrollFAB(distFromBottom > 200)
          ticking = false
        })
        ticking = true
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // Health check ping every 15s
  useEffect(() => {
    let mounted = true
    async function ping() {
      try {
        const healthUrl = API_BASE_URL ? `${API_BASE_URL}/health` : '/health'
        const r = await fetch(healthUrl, { cache: 'no-store' })
        if (mounted) setHealthy(r.ok)
      } catch {
        if (mounted) setHealthy(false)
      }
    }
    ping()
    const t = setInterval(ping, 15000)
    return () => { mounted = false; clearInterval(t) }
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  // Auto-focus on load (skip when intro is showing)
  useEffect(() => {
    if (!showIntro) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [showIntro])

  // Detect Speech API support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setSpeechSupported(!!SpeechRecognition)
  }, [])

  // Toggle voice input
  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      // Stop listening
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
      setIsListening(false)
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    // Use the user's system language for much better recognition accuracy
    recognition.lang = window.navigator.language || 'en-US'

    // Capture the existing input right before we start listening
    const currentInput = inputRef.current?.value || ''
    const baseInput = currentInput.endsWith(' ') || currentInput === '' ? currentInput : currentInput + ' '

    recognition.onresult = (event) => {
      let sessionTranscript = ''
      // Rebuild the entire transcript from 0 to avoid word repetition bugs in continuous mode
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          sessionTranscript += transcript + ' '
        } else {
          sessionTranscript += transcript
        }
      }
      // Update state with base input + live transcript (including interims so user sees live "guessing")
      setInput((baseInput + sessionTranscript).slice(0, MAX_INPUT_CHARS))
    }

    recognition.onerror = (event) => {
      console.warn('[Voice] error:', event.error)
      setIsListening(false)
      recognitionRef.current = null
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone permission.')
      }
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    triggerHaptic(15)
  }, [isListening])

  const canSend = useMemo(() => (input.trim().length > 0 || attachedImage) && !loading, [input, attachedImage, loading])

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && typeof messages[i].content === 'string') return messages[i]
    }
    return null
  }, [messages])

  const followUpSuggestions = useMemo(
    () => lastAssistantMessage ? extractFollowUpSuggestions(lastAssistantMessage.content) : [],
    [lastAssistantMessage]
  )

  // ── Drag & Drop handlers ──────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files can be dropped here')
      return
    }
    setCompressingImage(true)
    setError('Compressing image…')
    try {
      const base64 = await compressImageToBase64(file)
      setAttachedImage(base64)
      setError('')
    } catch (err) {
      setError('Failed to process image: ' + err.message)
    } finally {
      setCompressingImage(false)
    }
  }, [])

  async function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file || compressingImage) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setCompressingImage(true)
    setError('Compressing image…')

    try {
      const base64 = await compressImageToBase64(file)
      setAttachedImage(base64)
      setError('')
    } catch (err) {
      setError('Failed to process image: ' + err.message)
    } finally {
      setCompressingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removeAttachedImage() {
    setAttachedImage(null)
    setCompressingImage(false)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Send message with streaming ───────────────────────
  async function sendMessage() {
    if (!canSend) return
    // Auto-stop voice recording when sending
    if (isListening) {
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
      setIsListening(false)
    }
    setError('')

    const userMsg = {
      role: 'user',
      content: input.trim() || (attachedImage ? "What's in this image?" : ''),
      time: Date.now(),
      image: attachedImage || undefined
    }

    const allMessages = [...messages, userMsg]
    setMessages(allMessages)
    setInput('')
    setAttachedImage(null)
    triggerHaptic(10)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setLoading(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Streaming placeholder message
    const aiMsgIndex = allMessages.length
    const aiMsg = { role: 'assistant', content: '', time: Date.now(), isStreaming: true, streamDone: false }
    setMessages(prev => [...prev, aiMsg])

    const streamUrl = API_BASE_URL ? `${API_BASE_URL}/api/chat/stream` : '/api/chat/stream'
    let accumulatedContent = ''

    try {
      const res = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, temperature: settings.temperature }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Request failed with status ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          if (trimmed === 'data: [DONE]') {
            setMessages(prev => prev.map((m, i) =>
              i === aiMsgIndex ? { ...m, content: accumulatedContent, isStreaming: true, streamDone: true } : m
            ))
            continue
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const payload = JSON.parse(trimmed.slice(6))
              if (payload.error) throw new Error(payload.error)
              if (typeof payload.token === 'string') {
                accumulatedContent += payload.token
                setMessages(prev => prev.map((m, i) =>
                  i === aiMsgIndex ? { ...m, content: accumulatedContent } : m
                ))
              }
            } catch (parseErr) {
              if (parseErr.message !== 'Unexpected end of JSON input') {
                throw parseErr
              }
            }
          }
        }
      }

      // Finalize message
      setMessages(prev => prev.map((m, i) =>
        i === aiMsgIndex ? { ...m, content: accumulatedContent, isStreaming: false, streamDone: true } : m
      ))
    } catch (e) {
      if (e.name === 'AbortError') {
        setError('Request cancelled')
        // Keep whatever we got so far
        setMessages(prev => prev.map((m, i) =>
          i === aiMsgIndex ? { ...m, isStreaming: false, streamDone: true } : m
        ))
      } else {
        setError(e.message || 'Request failed')
        // Remove placeholder if nothing was streamed
        setMessages(prev => {
          if (prev[aiMsgIndex]?.content === '') {
            return prev.filter((_, i) => i !== aiMsgIndex)
          }
          return prev.map((m, i) => i === aiMsgIndex ? { ...m, isStreaming: false, streamDone: true } : m)
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSuggestionClick = useCallback((text) => {
    if (!text) return
    setInput(text)
    setError('')
    inputRef.current?.focus()
  }, [])

  function regenerateLast() {
    const lastUserIndex = [...messages].map(m => m.role).lastIndexOf('user')
    if (lastUserIndex === -1) return
    const base = messages.slice(0, lastUserIndex)
    const lastUser = messages[lastUserIndex]
    setMessages(base)
    setInput(lastUser.content)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearHistory() {
    if (!window.confirm("Delete ALL chat history? This cannot be undone.")) return
    setSessions([])
    const newId = generateId()
    setCurrentSessionId(newId)
    setMessages([])
    setError('')
  }

  function deleteSession(id) {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id)
      if (id === currentSessionId) {
        if (updated.length > 0) {
          setCurrentSessionId(updated[0].id)
          setMessages(updated[0].messages)
        } else {
          setCurrentSessionId(generateId())
          setMessages([])
        }
      }
      return updated
    })
  }

  function switchSession(id) {
    if (loading) return
    const s = sessions.find(x => x.id === id)
    if (s) {
      setCurrentSessionId(id)
      setMessages(s.messages || [])
      setShowSettings(false)
      setTimeout(() => scrollToBottom('auto'), 50)
    }
  }

  function newChat() {
    if (messages.length === 0) return // Already in a new chat
    const newId = generateId()
    setCurrentSessionId(newId)
    setMessages([])
    setInput('')
    setError('')
    setAttachedImage(null)
    setCompressingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function closeIntro() {
    setShowIntro(false)
    localStorage.setItem('alpha_has_seen_intro', 'true')
    setTimeout(() => inputRef.current?.focus(), 150)
  }

  function stopRequest() {
    try { abortRef.current?.abort() } catch { }
  }

  const healthDot =
    healthy === false ? 'bg-rose-500' :
      healthy === true ? 'bg-emerald-500' :
        'bg-sand-400'

  const charCount = input.length
  const charOverLimit = charCount > MAX_INPUT_CHARS

  return (
    <ErrorBoundary>
      <div
        className={`w-full h-[100dvh] flex flex-col overflow-hidden text-white relative ${isDragOver ? 'drag-over-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="mesh-bg">
          <div className="mesh-blob mesh-blob-1" />
          <div className="mesh-blob mesh-blob-2" />
        </div>
        {showIntro && <AlphaIntro onClose={closeIntro} />}

        {/* Drag overlay */}
        {isDragOver && (
          <div className="drag-overlay" aria-hidden>
            <div className="drag-overlay-inner">
              <div className="text-5xl mb-3">🖼️</div>
              <div className="text-xl font-semibold text-white">Drop image to attach</div>
            </div>
          </div>
        )}

        <div className="w-full flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden relative">
          
          {/* Mobile Settings Overlay */}
          <div 
            className={`md:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${showSettings ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => { setShowSettings(false); triggerHaptic([5, 10]); }}
            aria-hidden="true"
          />

          {/* ── Sidebar ── */}
          <aside
            aria-label="Settings panel"
            className={`glass-sidebar absolute md:relative h-full w-[85%] max-w-sm md:w-80 md:flex-shrink-0 overflow-hidden flex flex-col z-40 transition-transform duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${showSettings ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          >
            <div className={`h-20 flex items-center justify-between px-6 border-b flex-shrink-0 transition-colors ${theme === 'dark' ? 'border-white/5 bg-black/20' : 'border-black/5 bg-black/5'}`}>
              <div className={`font-bold tracking-widest uppercase text-xs flex items-center gap-3 ${theme === 'dark' ? 'text-white' : 'text-stone-800'}`}>
                 <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 shadow-[0_0_10px_rgba(0,240,255,0.6)] animate-pulse"></div>
                 System Core
              </div>
              <button
                aria-label="Close settings"
                className={`md:hidden flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-90 ${theme === 'dark' ? 'border-white/10 bg-white/5 text-stone-300 hover:text-white hover:bg-white/10' : 'border-black/10 bg-black/5 text-stone-500 hover:text-black hover:bg-black/10'}`}
                onClick={() => { setShowSettings(false); triggerHaptic(5); }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6 nice-scrollbar">
              {/* Chat History */}
              <div className="space-y-3 mb-6 px-1">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 ${theme === 'dark' ? 'text-[#00F0FF]' : 'text-[#048CBA]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-stone-600'}`}>History</span>
                  </div>
                  <button onClick={newChat} title="New Chat" className={`flex items-center justify-center w-6 h-6 rounded-full transition-all shadow-sm group ${theme === 'dark' ? 'bg-white/5 hover:bg-[#00F0FF]/20 text-[#00F0FF] hover:text-white hover:shadow-[0_0_10px_rgba(0,240,255,0.3)]' : 'bg-black/5 hover:bg-[#048CBA]/20 text-[#048CBA] hover:text-black hover:shadow-[0_0_10px_rgba(4,140,186,0.3)]'}`}>
                    <svg className="w-3.5 h-3.5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <div className={`text-xs italic rounded-lg p-3 border flex items-center justify-center ${theme === 'dark' ? 'text-stone-500 bg-black/20 border-white/5' : 'text-stone-500 bg-black/5 border-black/5'}`}>No previous chats</div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 nice-scrollbar">
                    {sessions.map(s => {
                      const isActive = currentSessionId === s.id;
                      return (
                        <div 
                          key={s.id} 
                          onClick={() => switchSession(s.id)} 
                          className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 cursor-pointer text-sm transition-all duration-300 border ${isActive ? (theme === 'dark' ? 'bg-gradient-to-r from-[#00F0FF]/10 to-[#7000FF]/10 border-[#00F0FF]/30 shadow-[0_4px_15px_rgba(0,0,0,0.2)]' : 'bg-gradient-to-r from-[#048CBA]/10 to-[#6B21A8]/10 border-[#048CBA]/30 shadow-[0_4px_15px_rgba(0,0,0,0.05)]') : (theme === 'dark' ? 'bg-black/20 border-white/5 hover:border-white/10 hover:bg-white/5 hover:translate-x-1' : 'bg-black/5 border-black/5 hover:border-black/10 hover:bg-black/10 hover:translate-x-1')}`}
                        >
                          {isActive && <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3/5 rounded-r-full shadow-glow ${theme === 'dark' ? 'bg-gradient-to-b from-[#00F0FF] to-[#7000FF]' : 'bg-gradient-to-b from-[#048CBA] to-[#6B21A8]'}`}></div>}
                          
                          <div className={`truncate pr-2 select-none flex items-center gap-2.5 ${isActive ? (theme === 'dark' ? 'text-white font-medium' : 'text-stone-900 font-medium') : (theme === 'dark' ? 'text-stone-400 group-hover:text-stone-200' : 'text-stone-500 group-hover:text-stone-800')}`}>
                            <svg className={`w-3.5 h-3.5 shrink-0 transition-opacity ${isActive ? (theme === 'dark' ? 'text-[#00F0FF] opacity-100' : 'text-[#048CBA] opacity-100') : 'opacity-40'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                            <span className="truncate">{s.title || 'New Chat'}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                            className={`flex items-center justify-center w-7 h-7 rounded-md transition-all ${isActive ? 'text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 opacity-60 hover:opacity-100' : 'text-stone-500 hover:bg-rose-500/20 hover:text-rose-400 opacity-0 group-hover:opacity-100'} shrink-0`}
                            title="Delete Chat"
                            aria-label="Delete Chat"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Theme Toggle Premium Segmented Control */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-[0.15em] ml-1">
                  Interface Theme
                </label>
                <div className={`relative flex p-1 rounded-xl border shadow-inner ${theme === 'dark' ? 'bg-black/30 border-white/5' : 'bg-black/5 border-black/5 shadow-none'}`}>
                  <div
                    className={`absolute inset-y-1 w-[calc(50%-4px)] rounded-lg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${theme === 'dark' ? 'bg-gradient-to-b from-white/15 to-white/5 border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5)] translate-x-0' : 'bg-white border border-black/5 shadow-[0_4px_12px_rgba(0,0,0,0.1)] translate-x-[calc(100%+8px)]'}`}
                  ></div>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors duration-300 ${theme === 'dark' ? 'text-white drop-shadow-md' : 'text-stone-500 hover:text-stone-700'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    Dark
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors duration-300 ${theme === 'light' ? 'text-stone-800 drop-shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    Light
                  </button>
                </div>
              </div>

              {/* Temperature Premium Slider */}
              <div className="space-y-2.5">
                <label htmlFor="temp-range" className="flex items-center justify-between text-[10px] font-bold text-stone-500 uppercase tracking-[0.15em] ml-1">
                  <span>Temperature</span>
                  <span className="text-cyan-400 font-mono text-[11px] drop-shadow-[0_0_5px_rgba(0,240,255,0.5)]">{settings.temperature.toFixed(2)}</span>
                </label>
                <div className="relative flex items-center py-2 group">
                  <input
                    id="temp-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.temperature}
                    onChange={(e) => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                    className="premium-slider w-full"
                    aria-label="Temperature control"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#00F0FF]/10 to-[#7000FF]/10 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                </div>
                <div className="flex justify-between text-[10px] text-stone-500 font-medium px-1">
                  <span>Precise</span>
                  <span>Creative</span>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <div className={`text-xs font-semibold uppercase tracking-wide ${theme === 'dark' ? 'text-stone-400' : 'text-stone-500'}`}>Backend Status</div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${healthDot} animate-pulse shadow-sm`} />
                  <span className={theme === 'dark' ? 'text-stone-300' : 'text-stone-600'}>
                    {healthy === true ? 'Connected' : healthy === false ? 'Disconnected' : 'Checking…'}
                  </span>
                </div>
              </div>

              {/* Keyboard shortcuts */}
              <div className="space-y-2">
                <div className={`text-xs font-semibold uppercase tracking-wide ${theme === 'dark' ? 'text-stone-400' : 'text-stone-500'}`}>Keyboard Shortcuts</div>
                <div className={`space-y-1.5 text-xs ${theme === 'dark' ? 'text-stone-500' : 'text-stone-600'}`}>
                  <div className="flex justify-between items-center">
                    <span>Send message</span>
                    <kbd className={`kbd-tag ${theme === 'dark' ? 'bg-white/5 border-white/10 text-stone-300' : 'bg-black/5 border-black/10 text-stone-600'}`}>Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>New line</span>
                    <kbd className={`kbd-tag ${theme === 'dark' ? 'bg-white/5 border-white/10 text-stone-300' : 'bg-black/5 border-black/10 text-stone-600'}`}>Shift + Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>New chat</span>
                    <kbd className={`kbd-tag ${theme === 'dark' ? 'bg-white/5 border-white/10 text-stone-300' : 'bg-black/5 border-black/10 text-stone-600'}`}>Ctrl + K</kbd>
                  </div>
                </div>
              </div>

              <div className={`pt-2 border-t ${theme === 'dark' ? 'border-white/5' : 'border-black/5'}`}>
                <button
                  aria-label="Clear all history"
                  className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-colors border ${theme === 'dark' ? 'bg-black/20 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border-white/5' : 'bg-black/5 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-black/5'}`}
                  onClick={clearHistory}
                >
                  🗑️ Clear all history
                </button>
              </div>
            </div>
          </aside>

          {/* ── Main column ── */}
          <div className="flex-1 flex flex-col min-w-0 h-full relative">
            {/* Floating Glass Crown Navbar */}
            <div className="absolute top-4 md:top-6 left-0 right-0 px-3 md:px-6 z-20 pointer-events-none flex justify-center">
              <header className="glass-header pointer-events-auto h-14 w-full max-w-4xl rounded-[24px] border border-[var(--border-glass)] flex items-center justify-between px-4 md:px-5 shadow-[0_12px_30px_rgba(0,0,0,0.5),_inset_0_1px_1px_rgba(255,255,255,0.1)] transition-all duration-300">
                <div className="flex items-center gap-3 md:gap-4">
                  <button
                    aria-label="Open settings"
                    className="md:hidden flex items-center justify-center w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:shadow-glow transition-all active:scale-95"
                    onClick={() => { setShowSettings(true); triggerHaptic(5); }}
                  >
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
                  </button>
                  <div className="flex items-center gap-2.5 drop-shadow-[0_2px_10px_rgba(0,240,255,0.3)]">
                    <div className="relative flex items-center justify-center w-5 h-5">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#00F0FF] to-[#7000FF] animate-[orbitSpinReverse_4s_linear_infinite]" />
                      <div className="absolute w-3 h-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
                    </div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight alpha-gradient-text contrast-125 mb-0.5">
                      Alpha
                    </h1>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    aria-label={healthy === true ? 'Backend online' : healthy === false ? 'Backend offline' : 'Checking connection'}
                    className={`hidden md:inline-block w-2.5 h-2.5 rounded-full ${healthDot} animate-pulse shadow-[0_0_8px_currentColor] mr-2`}
                  />
                  {loading ? (
                    <button
                      onClick={stopRequest}
                      aria-label="Stop generating"
                      className="group flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-all shadow-glow active:scale-95"
                    >
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                      <span className="hidden sm:inline">Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={newChat}
                      aria-label="Start new chat"
                      className="group flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:shadow-[0_0_15px_rgba(0,240,255,0.3)] transition-all active:scale-95"
                    >
                      <svg className="w-4 h-4 transition-transform group-hover:rotate-90 group-hover:text-[#00F0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                      <span className="hidden sm:inline">New chat</span>
                    </button>
                  )}
                </div>
              </header>
            </div>

            {/* Messages Area */}
            <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
              <div
                ref={containerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 pt-24 pb-28 md:pt-28 md:pb-36 space-y-4 nice-scrollbar"
                aria-label="Chat messages"
                aria-live="polite"
              >
                {/* Empty state */}
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-6 drop-shadow-xl z-10 relative">
                    <div>
                      <div className="text-6xl md:text-8xl font-black alpha-gradient-text mb-2 tracking-tighter">
                        ALPHA
                      </div>
                      <div className="text-stone-300 text-sm font-medium">Your intelligent AI assistant</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
                      {[
                        { icon: '💡', title: 'Ask anything', sub: 'Questions, ideas, explanations' },
                        { icon: '🖼️', title: 'Analyze images', sub: 'Upload photos for vision AI' },
                        { icon: '💻', title: 'Write code', sub: 'Debug, explain, and generate' },
                        { icon: '📝', title: 'Draft content', sub: 'Emails, essays, summaries' },
                      ].map(({ icon, title, sub }, i) => (
                        <button
                          key={title}
                          onClick={() => {
                            const prompt = STARTER_PROMPTS[title]
                            if (prompt) {
                              setInput(prompt)
                              triggerHaptic(10)
                              inputRef.current?.focus()
                            }
                          }}
                          className="stagger-enter starter-card flex items-start gap-3 p-3.5 rounded-2xl glass-button text-left cursor-pointer group"
                          style={{ animationDelay: `${i * 100}ms` }}
                        >
                          <span className="text-xl group-hover:scale-110 transition-transform">{icon}</span>
                          <div>
                            <div className="text-sm font-semibold text-white">{title}</div>
                            <div className="text-xs text-stone-400 mt-0.5">{sub}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="text-sm text-stone-400">Click a card or type a message · drag an image to attach</p>
                  </div>
                )}

                {/* Messages */}
                {messages.map((m, idx) => (
                  <MessageBubble
                    key={idx}
                    role={m.role}
                    content={m.content}
                    time={m.time}
                    image={m.image}
                    isStreaming={m.isStreaming}
                    streamDone={m.streamDone}
                  />
                ))}

                {/* Regenerate + follow-up suggestions */}
                {!loading && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.isStreaming && (
                  <div className="flex flex-col items-center md:items-start gap-2.5">
                    <div className="flex justify-center w-full">
                      <button
                        onClick={regenerateLast}
                        aria-label="Regenerate last response"
                        className="text-xs rounded-xl px-3 py-1.5 glass-button text-stone-300 hover:text-white transition-colors"
                      >
                        🔄 Regenerate response
                      </button>
                    </div>
                    {followUpSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-center md:justify-start w-full">
                        {followUpSuggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => handleSuggestionClick(s)}
                            aria-label={`Ask: ${s}`}
                            className="text-xs md:text-sm rounded-full px-3.5 py-1.5 glass-button text-stone-300 hover:text-white transition-all"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Thinking shimmer */}
                {loading && messages[messages.length - 1]?.content === '' && (
                  <ThinkingBubble />
                )}

                {/* Error message */}
                {error && (
                  <div className="flex justify-center" role="alert">
                    <div className="glass-error flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{error}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Scroll-to-bottom FAB */}
              <ScrollToBottomFAB
                visible={showScrollFAB}
                onClick={() => scrollToBottom('smooth')}
              />
            </main>

            {/* Floating Pill Footer / Input area */}
            <div 
              className="absolute bottom-4 md:bottom-6 left-0 right-0 px-3 md:px-6 z-20 pointer-events-none flex justify-center"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              <footer
                aria-label="Message input"
                className="floating-pill-footer w-full max-w-4xl glass-footer p-2 md:p-2.5 rounded-[2rem] border border-[var(--border-glass)] space-y-1.5 shadow-2xl pointer-events-auto transition-all duration-300 focus-within:shadow-[0_20px_40px_rgba(0,0,0,0.4),_0_0_20px_var(--accent-glow)] focus-within:-translate-y-1"
              >
              {/* Image preview */}
              {attachedImage && (
                <div className="relative inline-block">
                  <div className="relative w-14 h-14 md:w-16 md:h-16 rounded-xl overflow-hidden border border-[var(--border-glass)] shadow-soft">
                    <img src={attachedImage} alt="Attached preview" className="w-full h-full object-cover" />
                    <button
                      onClick={removeAttachedImage}
                      aria-label="Remove attached image"
                      className="absolute top-0.5 right-0.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] shadow-md transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              {/* Unified input bar — icons inside */}
              <div className={`input-bar-wrapper ${charOverLimit ? 'input-bar-error' : ''} ${isListening ? 'input-bar-recording' : ''}`}>
                {/* Hidden file input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageSelect}
                  className="hidden"
                  id="image-upload"
                  aria-label="Upload image"
                />

                {/* Left action buttons */}
                <div className="flex items-center gap-0.5 pl-1.5 flex-shrink-0">
                  {/* Camera / upload button */}
                  <label
                    htmlFor="image-upload"
                    aria-label="Attach image"
                    title="Attach image or take photo"
                    className={`input-bar-btn cursor-pointer ${compressingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {compressingImage ? (
                      <svg className="w-[18px] h-[18px] animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    ) : (
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </label>

                  {/* Voice input button */}
                  {speechSupported && (
                    <button
                      onClick={toggleVoiceInput}
                      aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                      title={isListening ? 'Stop listening' : 'Voice input'}
                      className={`input-bar-btn ${isListening ? 'input-bar-btn-recording' : ''}`}
                    >
                      {isListening && <span className="input-bar-pulse" aria-hidden />}
                      <svg className="w-[18px] h-[18px] relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-12a3 3 0 00-3 3v4a3 3 0 006 0v-4a3 3 0 00-3-3z" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Textarea */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={attachedImage ? 'Ask about the image…' : 'Message Alpha…'}
                  rows={1}
                  maxLength={MAX_INPUT_CHARS + 500}
                  aria-label="Message input"
                  className="input-bar-textarea"
                />

                {/* Right side — char count + send */}
                <div className="flex items-center gap-1.5 pr-1.5 flex-shrink-0">
                  {charCount > MAX_INPUT_CHARS * 0.85 && (
                    <span className={`text-[10px] font-mono leading-none ${charOverLimit ? 'text-rose-500 font-bold' : 'text-amber-500'}`}>
                      {charCount}/{MAX_INPUT_CHARS}
                    </span>
                  )}
                  <button
                    onClick={sendMessage}
                    disabled={!canSend || charOverLimit}
                    aria-label="Send message"
                    className="input-bar-send"
                  >
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Desktop hint */}
              <div className="hidden md:flex items-center justify-center px-0.5">
                <div className="text-[10px] text-stone-500 leading-tight">
                  Enter ↵ to send · Shift+Enter for new line
                </div>
              </div>
            </footer>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
