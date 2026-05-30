import { useNavigate } from 'react-router-dom'
import { Channel } from '../api/client'

const GRADIENTS = [
  'from-purple-600 to-blue-700',
  'from-pink-600 to-purple-700',
  'from-blue-600 to-cyan-700',
  'from-green-600 to-teal-700',
  'from-orange-600 to-red-700',
]

function gradient(name: string) {
  let h = 0
  for (const c of name) h += c.charCodeAt(0)
  return GRADIENTS[h % GRADIENTS.length]
}

export default function ChannelCard({ channel }: { channel: Channel }) {
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate(`/watch/${channel.id}`)}
      className="cursor-pointer group rounded-lg overflow-hidden bg-gray-800 hover:ring-2 hover:ring-purple-500 transition-all"
    >
      {/* Thumbnail */}
      <div className={`relative aspect-video bg-gradient-to-br ${gradient(channel.username)} flex items-center justify-center`}>
        <span className="text-4xl font-bold text-white/20 uppercase">
          {channel.username[0]}
        </span>
        <span className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">
          LIVE
        </span>
        <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
          {channel.viewerCount.toLocaleString()} viewers
        </span>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="font-semibold text-white truncate group-hover:text-purple-300 transition-colors">
          {channel.title || `${channel.username}'s stream`}
        </p>
        <p className="text-sm text-gray-400 mt-0.5">{channel.username}</p>
      </div>
    </div>
  )
}
