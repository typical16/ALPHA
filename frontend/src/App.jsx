import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import imageCompression from 'browser-image-compression'
import 'katex/dist/katex.min.css'

// Configure axios base URL for production
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? '' : '');
axios.defaults.baseURL = API_BASE_URL;

/** Normalize LaTeX delimiters so remark-math can render: \( \) -> $ $ and \[ \] -> $$ $$ */
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
  } catch {}
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

    // stop if we hit a new markdown heading after we've started collecting
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
      // once we started reading the list, stop on the first non-list line
      break
    }
  }

  return suggestions
}

function AlphaIntro({ onClose }) {
  const [animationStage, setAnimationStage] = useState(0)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  
  useEffect(() => {
    const timer1 = setTimeout(() => setAnimationStage(1), 200)
    const timer2 = setTimeout(() => setAnimationStage(2), 1000)
    const timer3 = setTimeout(() => setAnimationStage(3), 2000)
    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2
      setMousePos({
        x: (e.clientX - centerX) / centerX * 15,
        y: (e.clientY - centerY) / centerY * 15
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const letters = ['A', 'L', 'P', 'H', 'A']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-sage-900 via-sage-700 to-amber-800 overflow-hidden">
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/10 animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${Math.random() * 4 + 2}px`,
              height: `${Math.random() * 4 + 2}px`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${Math.random() * 3 + 2}s`
            }}
          />
        ))}
      </div>

      <div className="text-center relative z-10">
        {/* 3D Logo Container */}
        <div 
          className="relative mb-8"
          style={{
            perspective: '1200px',
            perspectiveOrigin: 'center center',
            transformStyle: 'preserve-3d',
          }}
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
                {/* Front face */}
                <div
                  className="alpha-letter-face alpha-letter-front"
                  style={{
                    transform: 'translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #7A8B84 0%, #D97706 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 15px rgba(218, 119, 6, 0.6))',
                  }}>
                    {letter}
                  </span>
                </div>
                {/* Back face */}
                <div
                  className="alpha-letter-face alpha-letter-back"
                  style={{
                    transform: 'rotateY(180deg) translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #D97706 0%, #7A8B84 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 10px rgba(122, 139, 132, 0.5))',
                  }}>
                    {letter}
                  </span>
                </div>
                {/* Top face */}
                <div
                  className="alpha-letter-face alpha-letter-top"
                  style={{
                    transform: 'rotateX(90deg) translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #66766F 0%, #F59E0B 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.4))',
                  }}>
                    {letter}
                  </span>
                </div>
                {/* Bottom face */}
                <div
                  className="alpha-letter-face alpha-letter-bottom"
                  style={{
                    transform: 'rotateX(-90deg) translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #66766F 0%, #F59E0B 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.4))',
                  }}>
                    {letter}
                  </span>
                </div>
                {/* Right face */}
                <div
                  className="alpha-letter-face alpha-letter-right"
                  style={{
                    transform: 'rotateY(90deg) translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #515E59 0%, #D97706 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 8px rgba(217, 119, 6, 0.4))',
                  }}>
                    {letter}
                  </span>
                </div>
                {/* Left face */}
                <div
                  className="alpha-letter-face alpha-letter-left"
                  style={{
                    transform: 'rotateY(-90deg) translateZ(50px)',
                  }}
                >
                  <span style={{
                    background: 'linear-gradient(135deg, #515E59 0%, #D97706 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    filter: 'drop-shadow(0 0 8px rgba(217, 119, 6, 0.4))',
                  }}>
                    {letter}
                  </span>
                </div>
              </div>
            ))}
          </div>
          </div>
          
          {/* Glow effect */}
          <div 
            className={`absolute inset-0 blur-3xl opacity-60 transition-opacity duration-1000 ${
              animationStage >= 2 ? 'opacity-60' : 'opacity-0'
            }`}
            style={{
              background: 'radial-gradient(circle, rgba(218, 119, 6, 0.4) 0%, rgba(122, 139, 132, 0.4) 100%)',
              transform: 'translateZ(-100px) scale(1.5)',
              animation: animationStage >= 2 ? 'pulseGlow 2s ease-in-out infinite' : 'none'
            }}
          />
        </div>

        {/* Subtitle */}
        <p 
          className={`text-xl md:text-2xl text-white/90 font-light transition-all duration-700 delay-500 ${
            animationStage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          Your intelligent AI assistant
        </p>
        
        {/* Get Started Button */}
        <button
          onClick={onClose}
          className={`mt-8 px-8 py-3 rounded-xl bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/20 transition-all duration-300 shadow-lg hover:shadow-xl ${
            animationStage >= 3 ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
          }`}
        >
          Get Started
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [messages, setMessages] = useState(() => loadHistory())
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [attachedImage, setAttachedImage] = useState(null) // base64 image data
  const [showIntro, setShowIntro] = useState(() => {
    // Show intro only on first visit
    const hasSeenIntro = localStorage.getItem('alpha_has_seen_intro')
    return !hasSeenIntro
  })
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_SETTINGS)
      if (!raw) return { temperature: 0.7 }
      const parsed = JSON.parse(raw)
      return {
        temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.7,
      }
    } catch {
      return { temperature: 0.7 }
    }
  })

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)
  const [healthy, setHealthy] = useState(null) // null=unknown, true/false

  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  useEffect(() => {
    try { localStorage.setItem(LOCAL_STORAGE_SETTINGS, JSON.stringify(settings)) } catch {}
  }, [settings])

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    // initial health check and periodic ping
    let mounted = true
    async function ping() {
      try {
        const healthUrl = API_BASE_URL ? `${API_BASE_URL}/health` : '/health'
        const r = await fetch(healthUrl, { cache: 'no-store' })
        if (!mounted) return
        setHealthy(r.ok)
      } catch {
        if (!mounted) return
        setHealthy(false)
      }
    }
    ping()
    const t = setInterval(ping, 15000)
    return () => { mounted = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    // autoresize input
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const canSend = useMemo(() => (input.trim().length > 0 || attachedImage) && !loading, [input, attachedImage, loading])

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && typeof messages[i].content === 'string') return messages[i]
    }
    return null
  }, [messages])

  const followUpSuggestions = useMemo(
    () => (lastAssistantMessage ? extractFollowUpSuggestions(lastAssistantMessage.content) : []),
    [lastAssistantMessage]
  )

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    
    setError('Compressing image...')
    
    // Compress the image
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true
    }
    
    imageCompression(file, options)
      .then((compressedFile) => {
        const reader = new FileReader()
        reader.onload = (event) => {
          const base64 = event.target.result
          setAttachedImage(base64)
          setError('')
        }
        reader.onerror = () => {
          setError('Failed to read image file')
        }
        reader.readAsDataURL(compressedFile)
      })
      .catch((error) => {
        setError('Failed to compress image: ' + error.message)
      })
  }

  function removeAttachedImage() {
    setAttachedImage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function sendMessage() {
    if (!canSend) return
    setError('')
    
    // Build user message with optional image
    const userMsg = {
      role: 'user',
      content: input.trim() || (attachedImage ? 'What\'s in this image?' : ''),
      time: Date.now(),
      image: attachedImage || undefined
    }
    
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachedImage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setLoading(true)

    // allow cancel
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await axios.post('/api/chat', {
        messages: [...messages, userMsg],
        temperature: settings.temperature,
      }, { signal: controller.signal })
      const fullContent = res.data?.content || 'No response'
      const aiMsg = { role: 'assistant', content: fullContent, time: Date.now(), isTyping: true }
      setMessages(prev => [...prev, aiMsg])
    } catch (e) {
      if (axios.isCancel?.(e)) {
        setError('Request cancelled')
      } else {
        const msg = e?.response?.data?.error || e?.message || 'Request failed'
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSuggestionClick(text) {
    if (!text) return
    setInput(text)
    setError('')
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  function regenerateLast() {
    // resend the last user message
    const lastUserIndex = [...messages].map(m=>m.role).lastIndexOf('user')
    if (lastUserIndex === -1) return
    const base = messages.slice(0, lastUserIndex)
    const lastUser = messages[lastUserIndex]
    setMessages(base) // drop any assistant after that
    setInput(lastUser.content)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearHistory() {
    setMessages([])
    setError('')
  }

  function newChat() {
    setMessages([])
    setInput('')
    setError('')
    setAttachedImage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function closeIntro() {
    setShowIntro(false)
    localStorage.setItem('alpha_has_seen_intro', 'true')
  }

  function stopRequest() {
    try { abortRef.current?.abort() } catch {}
  }

  return (
    <div className="w-full h-screen flex flex-col text-stone-900 overflow-hidden">
      {showIntro && <AlphaIntro onClose={closeIntro} />}
      <div className="w-full flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden">
        {/* Sidebar */}
        <aside className={
          'backdrop-blur w-full md:w-80 md:flex-shrink-0 md:block border-r ' +
          'bg-sand-100/80 border-sand-500/30 overflow-hidden flex flex-col ' +
          (showSettings ? 'block' : 'hidden md:block')
        }>
          <div className="h-14 flex items-center justify-between px-4 border-b border-sand-500/30 flex-shrink-0">
            <div className="font-semibold">Settings</div>
            <button className="md:hidden text-stone-500" onClick={()=> setShowSettings(false)}>Close</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-5 nice-scrollbar">
            <div>
              <label className="text-xs font-medium text-stone-600">Temperature: {settings.temperature.toFixed(2)}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.temperature}
                onChange={(e)=> setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                className="w-full accent-amber-600"
              />
            </div>
            <button
              className="w-full rounded-xl border px-3 py-2 text-sm bg-sand-100/80 hover:bg-sand-100 border-sand-500/30 shadow-soft"
              onClick={clearHistory}
            >Clear conversation</button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <header className="px-4 h-16 border-b backdrop-blur flex items-center justify-between flex-shrink-0 z-10 bg-sand-100/80 border-sand-500/30">
            <div className="flex items-center gap-3">
              <button className="md:hidden rounded-xl border px-3 py-1.5 text-sm bg-sand-100/80 border-sand-500/30 shadow-sm" onClick={()=> setShowSettings(s=>!s)}>Settings</button>
              <h1 className="text-lg md:text-xl font-bold tracking-tight flex items-center gap-2">
                <span className="bg-gradient-to-r from-sage-600 to-amber-600 bg-clip-text text-transparent">Alpha</span>
                <span className={"inline-block w-2 h-2 rounded-full animate-pulse " + (healthy === false ? 'bg-rose-500' : healthy === true ? 'bg-amber-600' : 'bg-sand-400')}/>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {loading ? (
                <button onClick={stopRequest} className="rounded-xl border px-3 py-1.5 text-sm bg-sand-100/80 border-sand-500/30 shadow-sm">Stop</button>
              ) : (
                <button onClick={newChat} className="rounded-xl border px-3 py-1.5 text-sm bg-sand-100/80 border-sand-500/30 shadow-sm">New chat</button>
              )}
            </div>
          </header>

          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5 nice-scrollbar">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="mb-6">
                    <div className="text-6xl md:text-7xl font-bold text-sage-600 mb-2 tracking-tight">ALPHA</div>
                    <div className="text-stone-400 text-sm">Your intelligent AI assistant</div>
                  </div>
                  <div className="text-stone-500 max-w-md space-y-2">
                    <p className="text-base">Ask me anything, or upload an image to get started!</p>
                    <div className="flex items-center justify-center gap-4 mt-4 text-xs text-stone-400">
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Upload images
                      </div>
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        Ask questions
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, idx) => (
                <MessageBubble
                  key={idx}
                  role={m.role}
                  content={m.content}
                  time={m.time}
                  image={m.image}
                  isTyping={m.isTyping}
                  onTypingComplete={m.isTyping ? () => {
                    setMessages(prev => prev.map((msg, i) => 
                      i === idx ? { ...msg, isTyping: false } : msg
                    ))
                  } : undefined}
                />
              ))}
              {!loading && messages.length > 0 && messages[messages.length-1]?.role === 'assistant' && (
                <div className="flex flex-col items-center md:items-start gap-2">
                  <div className="flex justify-center w-full">
                    <button onClick={regenerateLast} className="text-xs rounded-xl border px-3 py-1.5 bg-sand-100/80 border-sand-500/30 shadow-sm">Regenerate response</button>
                  </div>
                  {followUpSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center md:justify-start w-full">
                      {followUpSuggestions.map((s, idx) => (
                        <button
                          key={idx}
                          onClick={()=> handleSuggestionClick(s)}
                          className="text-xs md:text-sm rounded-full border px-3 py-1.5 bg-sand-100/80 border-sand-500/30 shadow-sm hover:bg-sand-100"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-sand-50 border border-sand-500/30 text-stone-900 max-w-[85%] rounded-2xl px-4 py-3 shadow-soft">
                    <span className="inline-flex gap-1 items-center">
                      <span className="w-2 h-2 bg-sand-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-2 h-2 bg-sand-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-2 h-2 bg-sand-500 rounded-full animate-bounce"></span>
                    </span>
                  </div>
                </div>
              )}
              {error && (
                <div className="flex justify-center">
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-md px-3 py-2 text-sm">
                    {error}
                  </div>
                </div>
              )}
            </div>
          </main>

          <footer className="border-t bg-sand-100/80 backdrop-blur p-3 flex-shrink-0 safe-area-bottom border-sand-500/30">
            {attachedImage && (
              <div className="mb-2 relative inline-block">
                <div className="relative w-24 h-24 rounded-lg overflow-hidden border-2 border-sage-500/50">
                  <img src={attachedImage} alt="Attached" className="w-full h-full object-cover" />
                  <button
                    onClick={removeAttachedImage}
                    className="absolute top-1 right-1 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-md"
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                capture="environment"
                onChange={handleImageSelect}
                className="hidden"
                id="image-upload"
              />
              <label
                htmlFor="image-upload"
                className="h-[44px] md:h-[48px] w-[44px] md:w-[48px] flex items-center justify-center rounded-xl border border-sand-500/30 bg-sand-100/80 hover:bg-sand-100 cursor-pointer shadow-sm transition-colors active:scale-95"
                title="Attach image or take photo"
              >
                <svg className="w-5 h-5 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </label>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e)=> setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={attachedImage ? "Ask about the image…" : "Send a message…"}
                rows={1}
                className="flex-1 resize-none max-h-40 min-h-[44px] rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 bg-sand-100/80 md:min-h-[48px] placeholder:text-stone-400 border-sand-500/30 focus:ring-sage-500/40"
              />
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className="h-[44px] md:h-[48px] px-4 rounded-xl bg-sage-600 hover:bg-sage-500 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
              >Send</button>
            </div>
              <div className="text-[11px] text-stone-500 mt-2">Enter to send. Shift+Enter for new line. Click camera icon to attach image.</div>
          </footer>
        </div>
      </div>
    </div>
  )
}

function TypingContent({ fullContent, onComplete }) {
  const [visibleLength, setVisibleLength] = useState(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const fullLen = fullContent.length
  const TYPING_SPEED_MS = 12
  const CHUNK_SIZE = 2

  useEffect(() => {
    if (visibleLength >= fullLen) {
      onCompleteRef.current?.()
      return
    }
    const t = setTimeout(() => {
      setVisibleLength(prev => Math.min(prev + CHUNK_SIZE, fullLen))
    }, TYPING_SPEED_MS)
    return () => clearTimeout(t)
  }, [visibleLength, fullLen])

  const visibleContent = fullContent.slice(0, visibleLength)
  const isComplete = visibleLength >= fullLen

  return (
    <div className="typing-response">
      <div className="prose prose-stone max-w-none min-w-0 overflow-hidden prose-a:text-sage-600 prose-strong:text-stone-900 prose-code:bg-sand-100 prose-code:px-1 prose-code:py-0.5 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-3 prose-code:before:content-[''] prose-code:after:content-[''] text-sm md:text-base markdown-math">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{normalizeMathDelimiters(visibleContent)}</ReactMarkdown>
      </div>
      {!isComplete && <span className="typing-cursor" aria-hidden>|</span>}
    </div>
  )
}

function MessageBubble({ role, content, time, image, isTyping, onTypingComplete }) {
  const isUser = role === 'user'
  async function copyText() {
    try {
      await navigator.clipboard.writeText(content)
    } catch {}
  }

  const showTypingAnimation = !isUser && isTyping && typeof content === 'string'

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'} style={{ minWidth: 0 }}>
      <div className={'flex max-w-[90%] md:max-w-[75%] min-w-0 gap-3 items-start'}>
        {!isUser && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sage-600 text-white shrink-0">AI</div>
        )}
        <div className={
          'rounded-2xl px-4 py-3 shadow-soft relative group min-w-0 overflow-hidden ' +
          (isUser ? 'bg-sage-600 text-white' : 'bg-sand-50 border border-sand-500/30 text-stone-900')
        }>
          {image && (
            <div className="mb-2 rounded-lg overflow-hidden max-w-sm">
              <img src={image} alt="User uploaded" className="w-full h-auto max-h-64 object-contain" />
            </div>
          )}
          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm md:text-base">{content}</div>
          ) : showTypingAnimation ? (
            <TypingContent fullContent={content} onComplete={onTypingComplete} />
          ) : (
            <div className="prose prose-stone max-w-none min-w-0 overflow-hidden prose-a:text-sage-600 prose-strong:text-stone-900 prose-code:bg-sand-100 prose-code:px-1 prose-code:py-0.5 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-3 prose-code:before:content-[''] prose-code:after:content-[''] text-sm md:text-base markdown-math">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{normalizeMathDelimiters(content)}</ReactMarkdown>
            </div>
          )}
          {!isUser && !showTypingAnimation && (
            <button onClick={copyText} className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 text-xs bg-stone-800 text-white rounded px-2 py-1">Copy</button>
          )}
          <div className={(isUser ? 'text-white/60' : 'text-stone-400') + ' text-[10px] mt-1 select-none'}>
            {time ? new Date(time).toLocaleTimeString() : ''}
          </div>
        </div>
        {isUser && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-800 text-white shrink-0">U</div>
        )}
      </div>
    </div>
  )
}


