import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

interface Props {
  hlsUrl: string
  live: boolean
}

export default function VideoPlayer({ hlsUrl, live }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!videoRef.current || !live) return
    setError(false)

    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 3 })
      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(videoRef.current)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(true)
      })
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      videoRef.current.src = hlsUrl
    }
  }, [hlsUrl, live])

  if (!live) {
    return (
      <div className="w-full aspect-video bg-gray-900 flex flex-col items-center justify-center gap-2">
        <div className="text-5xl">📴</div>
        <p className="text-gray-400 text-sm">Channel is offline</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full aspect-video bg-gray-900 flex flex-col items-center justify-center gap-2">
        <div className="text-5xl">⚠️</div>
        <p className="text-gray-400 text-sm">Stream unavailable</p>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      muted
      className="w-full aspect-video bg-black"
    />
  )
}
