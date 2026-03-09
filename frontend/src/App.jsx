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

const LOCAL_STORAGE_KEY = 'openrouter_chat_history_v1'
const LOCAL_STORAGE_SETTINGS = 'openrouter_chat_settings_v1'
const MAX_INPUT_CHARS = 4000

function loadHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(m => ({ ...m, isTyping: false }))
  } catch {
    return []
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(history))
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
          'rounded-2xl px-3.5 py-2.5 md:px-5 md:py-4 relative group min-w-0 overflow-hidden leading-relaxed ' +
          (isUser
            ? 'user-bubble'
            : 'ai-bubble glass-panel')
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
        <div className="ai-bubble glass-panel max-w-[85%] rounded-2xl px-3.5 py-2.5 md:px-5 md:py-4">
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
  const [messages, setMessages] = useState(() => loadHistory())
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

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)
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

  useEffect(() => { saveHistory(messages) }, [messages])
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
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollFAB(distFromBottom > 200)
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

  function clearHistory() { setMessages([]); setError('') }

  function newChat() {
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
            className={`glass-sidebar absolute md:relative h-full w-[80%] max-w-sm md:w-80 md:flex-shrink-0 overflow-hidden flex flex-col z-30 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${showSettings ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          >
            <div className="h-14 flex items-center justify-between px-5 border-b border-[var(--border-glass)] flex-shrink-0">
              <div className="font-semibold text-white tracking-tight">⚙️ Settings</div>
              <button
                aria-label="Close settings"
                className="md:hidden text-stone-500 hover:text-stone-800 text-sm px-2 py-1 rounded-lg hover:bg-stone-100 transition-colors"
                onClick={() => { setShowSettings(false); triggerHaptic(5); }}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6 nice-scrollbar">
              {/* Theme Toggle */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-stone-600 uppercase tracking-wide">
                  Theme
                </label>
                <div className="flex bg-black/20 rounded-lg p-1">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${theme === 'dark' ? 'bg-white/20 text-white shadow-sm' : 'text-stone-400 hover:text-stone-200'}`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${theme === 'light' ? 'bg-white/90 text-black shadow-sm' : 'text-stone-400 hover:text-stone-200'}`}
                  >
                    Light
                  </button>
                </div>
              </div>

              {/* Temperature */}
              <div className="space-y-2">
                <label htmlFor="temp-range" className="text-xs font-semibold text-stone-600 uppercase tracking-wide">
                  Temperature <span className="font-bold text-sage-700">{settings.temperature.toFixed(2)}</span>
                </label>
                <input
                  id="temp-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.temperature}
                  onChange={(e) => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-amber-600 h-1.5"
                  aria-label="Temperature control"
                />
                <div className="flex justify-between text-[10px] text-stone-400">
                  <span>Precise</span>
                  <span>Creative</span>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Backend Status</div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${healthDot} animate-pulse`} />
                  <span className="text-stone-600">
                    {healthy === true ? 'Connected' : healthy === false ? 'Disconnected' : 'Checking…'}
                  </span>
                </div>
              </div>

              {/* Keyboard shortcuts */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Keyboard Shortcuts</div>
                <div className="space-y-1.5 text-xs text-stone-500">
                  <div className="flex justify-between items-center">
                    <span>Send message</span>
                    <kbd className="kbd-tag">Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>New line</span>
                    <kbd className="kbd-tag">Shift + Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>New chat</span>
                    <kbd className="kbd-tag">Ctrl + K</kbd>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-stone-200">
                <button
                  aria-label="Clear conversation history"
                  className="w-full rounded-xl px-3 py-2.5 text-sm font-medium glass-button text-rose-400 hover:text-rose-300 shadow-sm transition-colors"
                  onClick={clearHistory}
                >
                  🗑️ Clear conversation
                </button>
              </div>
            </div>
          </aside>

          {/* ── Main column ── */}
          <div className="flex-1 flex flex-col min-w-0 h-full relative">
            {/* Header */}
            <header className="px-4 h-14 border-b border-[var(--border-glass)] glass-panel flex items-center justify-between flex-shrink-0 z-10 relative">
              <div className="flex items-center gap-3">
                <button
                  aria-label="Open settings"
                  className="md:hidden rounded-xl border px-3 py-1.5 text-sm font-medium glass-button text-white transition-colors"
                  onClick={() => { setShowSettings(true); triggerHaptic(5); }}
                >
                  ⚙️
                </button>
                <h1 className="text-lg md:text-xl font-bold tracking-tight flex items-center gap-2 drop-shadow-[0_2px_10px_rgba(0,240,255,0.3)]">
                  <span className="alpha-gradient-text contrast-125">
                    Alpha
                  </span>
                  <span
                    aria-label={healthy === true ? 'Backend online' : healthy === false ? 'Backend offline' : 'Checking connection'}
                    className={`inline-block w-2 h-2 rounded-full ${healthDot} animate-pulse`}
                  />
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {loading ? (
                  <button
                    onClick={stopRequest}
                    aria-label="Stop generating"
                    className="rounded-xl px-3 py-1.5 text-sm font-medium glass-button text-rose-400 hover:text-rose-300 transition-colors"
                  >
                    ⬛ Stop
                  </button>
                ) : (
                  <button
                    onClick={newChat}
                    aria-label="Start new chat"
                    className="rounded-xl px-3 py-1.5 text-sm font-medium glass-button text-white transition-colors"
                  >
                    ✏️ New chat
                  </button>
                )}
              </div>
            </header>

            {/* Messages */}
            <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
              <div
                ref={containerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 py-4 md:py-6 space-y-4 nice-scrollbar"
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
                          className="stagger-enter flex items-start gap-3 p-3.5 rounded-2xl glass-button text-left transition-all cursor-pointer active:scale-[0.98] group"
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
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2">
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

            {/* Footer / Input area */}
            <footer
              aria-label="Message input"
              className="border-t border-[var(--border-glass)] glass-panel px-4 md:px-8 py-4 flex-shrink-0 safe-area-bottom space-y-3 z-10"
            >
              {/* Image preview */}
              {attachedImage && (
                <div className="relative inline-block">
                  <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-sage-400/50 shadow-soft">
                    <img src={attachedImage} alt="Attached preview" className="w-full h-full object-cover" />
                    <button
                      onClick={removeAttachedImage}
                      aria-label="Remove attached image"
                      className="absolute top-1 right-1 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2">
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
                {/* Camera / upload button */}
                <label
                  htmlFor="image-upload"
                  aria-label="Attach image"
                  title="Attach image or take photo"
                  className={`glass-button min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl cursor-pointer shadow-sm transition-colors active:scale-95 flex-shrink-0 ${compressingImage ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {compressingImage ? (
                    <svg className="w-5 h-5 text-sage-600 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </label>

                {/* Text input */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={attachedImage ? 'Ask about the image…' : 'Send a message…'}
                  rows={1}
                  maxLength={MAX_INPUT_CHARS + 500}
                  aria-label="Message input"
                  className={`glass-input flex-1 resize-none max-h-40 min-h-[48px] rounded-2xl px-4 py-3 md:py-3.5 focus:outline-none placeholder:text-stone-500 min-w-0 text-sm md:text-base leading-relaxed ${charOverLimit ? 'border-rose-400 focus:ring-rose-400/40 focus:border-rose-400' : ''}`}
                />

                {/* Send button */}
                <button
                  onClick={sendMessage}
                  disabled={!canSend || charOverLimit}
                  aria-label="Send message"
                  className="send-btn relative min-h-[44px] md:min-h-[48px] px-4 md:px-5 rounded-xl hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed shadow-glow flex-shrink-0 font-medium text-sm transition-all active:scale-95 overflow-hidden"
                >
                  <span className="relative z-10">Send</span>
                  <div className="send-btn-pulse" />
                </button>
              </div>

              {/* Character counter + hint */}
              <div className="flex items-center justify-between px-0.5">
                <div className="text-[11px] text-stone-400 leading-tight">
                  Enter ↵ to send · Shift+Enter for new line
                </div>
                <div className={`text-[11px] leading-tight font-mono ${charOverLimit ? 'text-rose-500 font-semibold' : charCount > MAX_INPUT_CHARS * 0.85 ? 'text-amber-500' : 'text-stone-400'}`}>
                  {charCount} / {MAX_INPUT_CHARS}
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
