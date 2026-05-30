import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WS_URL } from '../api/client'

interface Message {
  username: string
  content: string
  timestamp: number
}

const USER_COLORS = [
  'text-purple-400', 'text-blue-400', 'text-green-400',
  'text-yellow-400', 'text-pink-400', 'text-cyan-400',
]

function userColor(username: string) {
  let h = 0
  for (const c of username) h += c.charCodeAt(0)
  return USER_COLORS[h % USER_COLORS.length]
}

export default function ChatBox({ channelId }: { channelId: string }) {
  const { token, user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return

    const ws = new WebSocket(`${WS_URL}/ws/${channelId}?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const msg: Message = JSON.parse(e.data)
        setMessages((prev) => [...prev.slice(-199), msg]) // keep last 200
      } catch { /* ignore malformed */ }
    }

    return () => ws.close()
  }, [channelId, token])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    const text = input.trim()
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(text)
    setInput('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') send()
  }

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <span className="font-semibold text-sm">Chat</span>
        <span className={`text-xs ${connected ? 'text-green-400' : 'text-gray-500'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
        {messages.length === 0 && (
          <p className="text-gray-500 text-xs text-center mt-4">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="text-sm break-words">
            <span className={`font-semibold ${userColor(msg.username)}`}>
              {msg.username}
            </span>
            <span className="text-gray-300">: {msg.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-700">
        {user ? (
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="Send a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={500}
            />
            <button
              onClick={send}
              disabled={!connected}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded text-sm font-medium transition-colors"
            >
              Chat
            </button>
          </div>
        ) : (
          <p className="text-center text-gray-500 text-xs">
            <a href="/login" className="text-purple-400 hover:underline">Log in</a> to chat
          </p>
        )}
      </div>
    </div>
  )
}
