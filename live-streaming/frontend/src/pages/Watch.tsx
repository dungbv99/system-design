import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Channel, getChannel } from '../api/client'
import VideoPlayer from '../components/VideoPlayer'
import ChatBox from '../components/ChatBox'

export default function Watch() {
  const { channelId } = useParams<{ channelId: string }>()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!channelId) return
    async function load() {
      try {
        const data = await getChannel(channelId!)
        setChannel(data)
      } finally {
        setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 15_000) // refresh viewer count
    return () => clearInterval(interval)
  }, [channelId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading...
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Channel not found
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-56px)]">
      {/* Left: video + info */}
      <div className="flex-1 flex flex-col min-w-0">
        <VideoPlayer hlsUrl={channel.hlsUrl} live={channel.live} />

        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-bold text-lg leading-tight">
                {channel.title || `${channel.username}'s stream`}
              </h1>
              <p className="text-gray-400 text-sm mt-0.5">{channel.username}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {channel.live && (
                <>
                  <span className="flex items-center gap-1.5 text-sm text-red-400 font-medium">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    LIVE
                  </span>
                  <span className="text-sm text-gray-400">
                    {channel.viewerCount.toLocaleString()} viewers
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: chat */}
      <div className="w-full lg:w-80 xl:w-96 h-64 lg:h-full border-l border-gray-800 shrink-0">
        <ChatBox channelId={channel.id} />
      </div>
    </div>
  )
}
