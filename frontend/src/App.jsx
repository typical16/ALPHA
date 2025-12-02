import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Configure axios base URL for production
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? '' : '');
axios.defaults.baseURL = API_BASE_URL;

const LOCAL_STORAGE_KEY = 'openrouter_chat_history_v1'
const LOCAL_STORAGE_SETTINGS = 'openrouter_chat_settings_v1'

function loadHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
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

export default function App() {
  const [messages, setMessages] = useState(() => loadHistory())
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
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

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading])

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

  async function sendMessage() {
    if (!canSend) return
    setError('')
    const userMsg = { role: 'user', content: input.trim(), time: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
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
      const aiMsg = { role: 'assistant', content: res.data?.content || 'No response', time: Date.now() }
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
  }

  function stopRequest() {
    try { abortRef.current?.abort() } catch {}
  }

  return (
    <div className="min-h-full text-stone-900">
      <div className="mx-auto max-w-6xl h-screen flex flex-col md:flex-row">
        {/* Sidebar */}
        <aside className={
          'backdrop-blur w-full md:w-80 md:flex-shrink-0 md:block border-r ' +
          'bg-sand-100/80 border-sand-500/30 ' +
          (showSettings ? 'block' : 'hidden md:block')
        }>
          <div className="h-14 flex items-center justify-between px-4 border-b border-sand-500/30">
            <div className="font-semibold">Settings</div>
            <button className="md:hidden text-stone-500" onClick={()=> setShowSettings(false)}>Close</button>
          </div>
          <div className="p-4 space-y-5">
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
        <div className="flex-1 h-screen flex flex-col">
          <header className="px-4 h-16 border-b backdrop-blur flex items-center justify-between sticky top-0 z-10 bg-sand-100/80 border-sand-500/30">
            <div className="flex items-center gap-3">
              <button className="md:hidden rounded-xl border px-3 py-1.5 text-sm bg-sand-100/80 border-sand-500/30 shadow-sm" onClick={()=> setShowSettings(s=>!s)}>Settings</button>
              <h1 className="text-lg md:text-xl font-semibold tracking-tight flex items-center gap-2">
                Alpha
                <span className={"inline-block w-2 h-2 rounded-full " + (healthy === false ? 'bg-rose-500' : healthy === true ? 'bg-amber-600' : 'bg-sand-400')}/>
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

          <main className="flex-1 overflow-hidden">
            <div ref={containerRef} className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5 nice-scrollbar">
              {messages.length === 0 && (
                <div className="text-center text-stone-500 mt-12">Start by asking a question…</div>
              )}
              {messages.map((m, idx) => (
                <MessageBubble key={idx} role={m.role} content={m.content} time={m.time} />
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

          <footer className="border-t bg-sand-100/80 backdrop-blur p-3 sticky bottom-0 safe-area-bottom border-sand-500/30">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e)=> setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Send a message…"
                rows={1}
                className="flex-1 resize-none max-h-40 min-h-[44px] rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 bg-sand-100/80 md:min-h-[48px] placeholder:text-stone-400 border-sand-500/30 focus:ring-sage-500/40"
              />
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className="h-[44px] md:h-[48px] px-4 rounded-xl bg-sage-600 hover:bg-sage-500 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
              >Send</button>
            </div>
              <div className="text-[11px] text-stone-500 mt-2">Enter to send. Shift+Enter for new line.</div>
          </footer>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, time }) {
  const isUser = role === 'user'
  async function copyText() {
    try {
      await navigator.clipboard.writeText(content)
    } catch {}
  }
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div className={'flex max-w-[90%] md:max-w-[75%] gap-3 items-start'}>
        {!isUser && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sage-600 text-white shrink-0">AI</div>
        )}
        <div className={
          'rounded-2xl px-4 py-3 shadow-soft relative group ' +
          (isUser ? 'bg-sage-600 text-white' : 'bg-sand-50 border border-sand-500/30 text-stone-900')
        }>
          {isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm md:text-base">{content}</div>
          ) : (
            <div className="prose prose-stone max-w-none prose-a:text-sage-600 prose-strong:text-stone-900 prose-code:bg-sand-100 prose-code:px-1 prose-code:py-0.5 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-3 prose-code:before:content-[''] prose-code:after:content-[''] text-sm md:text-base">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
          {!isUser && (
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


