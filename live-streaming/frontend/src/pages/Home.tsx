import { useEffect, useState } from 'react'
import { Channel, listLiveChannels } from '../api/client'
import ChannelCard from '../components/ChannelCard'

export default function Home() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const data = await listLiveChannels()
      setChannels(data)
    } catch {
      setChannels([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000) // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Live Channels</h1>
        <span className="text-sm text-gray-400">{channels.length} streaming</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden bg-gray-800 animate-pulse">
              <div className="aspect-video bg-gray-700" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-gray-700 rounded w-3/4" />
                <div className="h-3 bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
          <span className="text-5xl">📡</span>
          <p className="text-lg">No one is streaming right now</p>
          <p className="text-sm">Be the first — go to Dashboard and start streaming</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {channels.map((ch) => (
            <ChannelCard key={ch.id} channel={ch} />
          ))}
        </div>
      )}
    </main>
  )
}
