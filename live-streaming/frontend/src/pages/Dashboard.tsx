import { useEffect, useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Channel, getMyChannel, getStreamKey,
  updateChannelTitle, regenerateStreamKey,
} from '../api/client'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 transition-colors shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function Dashboard() {
  const { user, token } = useAuth()
  const navigate = useNavigate()

  const [channel, setChannel] = useState<Channel | null>(null)
  const [streamKey, setStreamKey] = useState('')
  const [rtmpUrl, setRtmpUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [title, setTitle] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (!token) { navigate('/login'); return }
    async function load() {
      const [ch, keyData] = await Promise.all([getMyChannel(), getStreamKey()])
      setChannel(ch)
      setTitle(ch.title ?? '')
      setStreamKey(keyData.streamKey)
      setRtmpUrl(keyData.rtmpUrl)
    }
    load()
  }, [token, navigate])

  async function saveTitle(e: FormEvent) {
    e.preventDefault()
    setTitleSaving(true)
    try {
      const updated = await updateChannelTitle(title)
      setChannel(updated)
    } finally {
      setTitleSaving(false)
    }
  }

  async function handleRegenerateKey() {
    if (!confirm('Regenerate stream key? Your current OBS setup will stop working.')) return
    setRegenerating(true)
    try {
      const data = await regenerateStreamKey()
      setStreamKey(data.streamKey)
      setRtmpUrl(data.rtmpUrl)
    } finally {
      setRegenerating(false)
    }
  }

  if (!channel) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">@{user?.username}</p>
        </div>
        <div className="flex items-center gap-2">
          {channel.live ? (
            <>
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 font-semibold text-sm">LIVE</span>
              <span className="text-gray-400 text-sm ml-2">
                {channel.viewerCount.toLocaleString()} viewers
              </span>
            </>
          ) : (
            <span className="text-gray-500 text-sm">Offline</span>
          )}
        </div>
      </div>

      {/* Stream title */}
      <div className="bg-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Stream Title</h2>
        <form onSubmit={saveTitle} className="flex gap-2">
          <input
            className="flex-1 bg-gray-700 rounded px-3 py-2 text-white outline-none focus:ring-2 focus:ring-purple-500 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you streaming today?"
            maxLength={255}
          />
          <button
            type="submit"
            disabled={titleSaving}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
          >
            {titleSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      {/* Stream setup */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Stream Setup</h2>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">RTMP Server URL</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 truncate">
              {rtmpUrl.substring(0, rtmpUrl.lastIndexOf('/'))}
            </code>
            <CopyButton value={rtmpUrl.substring(0, rtmpUrl.lastIndexOf('/'))} />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Stream Key</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 truncate font-mono">
              {showKey ? streamKey : '••••••••••••••••••••••••••••••••••••'}
            </code>
            <button
              onClick={() => setShowKey((v) => !v)}
              className="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 transition-colors shrink-0"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <CopyButton value={streamKey} />
          </div>
          <button
            onClick={handleRegenerateKey}
            disabled={regenerating}
            className="mt-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            {regenerating ? 'Regenerating...' : 'Regenerate key'}
          </button>
        </div>

        {/* OBS Instructions */}
        <div className="bg-gray-900 rounded-lg p-4 text-sm space-y-1 text-gray-400">
          <p className="font-medium text-gray-300 mb-2">OBS Setup</p>
          <p>1. Settings → Stream → Service: <strong className="text-gray-200">Custom</strong></p>
          <p>2. Server: <code className="text-purple-300">rtmp://localhost:1935/live</code></p>
          <p>3. Stream Key: <em className="text-gray-300">paste your key above</em></p>
          <p>4. Click <strong className="text-gray-200">Start Streaming</strong></p>
        </div>
      </div>

      {/* Watch link */}
      {channel.live && (
        <div className="bg-purple-900/30 border border-purple-700 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-purple-200">Your stream is live!</p>
          <a
            href={`/watch/${channel.id}`}
            className="text-sm px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded font-medium transition-colors"
          >
            Watch →
          </a>
        </div>
      )}
    </main>
  )
}
