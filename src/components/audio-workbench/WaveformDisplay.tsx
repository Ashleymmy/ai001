import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { AlertCircle } from 'lucide-react'

export type WaveformHandle = {
  play: (start?: number, end?: number) => void
  pause: () => void
  seekTo: (seconds: number) => void
  getDuration: () => number
  getCurrentTime: () => number
  isPlaying: () => boolean
}

export default forwardRef(function WaveformDisplay(
  {
    audioUrl,
    onReady,
    onTimeUpdate,
    onPlayStateChange,
  }: {
    audioUrl: string
    onReady?: (duration: number) => void
    onTimeUpdate?: (time: number) => void
    onPlayStateChange?: (isPlaying: boolean) => void
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<any>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setLoadError(null)
    const container = containerRef.current
    if (!container) return

    if (wsRef.current) {
      try {
        wsRef.current.destroy()
      } catch {
        // ignore
      }
      wsRef.current = null
    }

    if (!audioUrl) return

    try {
      const ws = WaveSurfer.create({
        container,
        height: 130,
        waveColor: 'rgba(147,197,253,0.55)',
        progressColor: 'rgba(236,72,153,0.75)',
        cursorColor: 'rgba(255,255,255,0.8)',
      })

      ws.on('ready', () => {
        try {
          onReady?.(ws.getDuration())
        } catch {
          // ignore
        }
      })
      ws.on('audioprocess', (t: number) => {
        onTimeUpdate?.(t)
      })
      ws.on('seek', () => {
        onTimeUpdate?.(ws.getCurrentTime())
      })
      ws.on('play', () => onPlayStateChange?.(true))
      ws.on('pause', () => onPlayStateChange?.(false))
      ws.on('finish', () => onPlayStateChange?.(false))
      ws.on('error', (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e || '加载失败')
        setLoadError(msg)
      })

      ws.load(audioUrl)
      wsRef.current = ws
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '初始化失败')
    }

    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.destroy()
        } catch {
          // ignore
        }
        wsRef.current = null
      }
    }
  }, [audioUrl, onReady, onPlayStateChange, onTimeUpdate])

  useImperativeHandle(ref, () => ({
    play: (start?: number, end?: number) => {
      if (!wsRef.current) return
      wsRef.current.play(start, end)
    },
    pause: () => {
      wsRef.current?.pause()
    },
    seekTo: (seconds: number) => {
      if (!wsRef.current) return
      const d = wsRef.current.getDuration()
      if (!d || !Number.isFinite(d)) return
      const t = Math.max(0, Math.min(d, Number.isFinite(seconds) ? seconds : 0))
      wsRef.current.setTime ? wsRef.current.setTime(t) : wsRef.current.seekTo(t / d)
    },
    getDuration: () => (wsRef.current ? wsRef.current.getDuration() : 0),
    getCurrentTime: () => (wsRef.current ? wsRef.current.getCurrentTime() : 0),
    isPlaying: () => (wsRef.current ? Boolean(wsRef.current.isPlaying()) : false),
  }))

  if (!audioUrl) {
    return (
      <div className="glass-dark rounded-xl p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <AlertCircle size={16} />
          <span className="text-sm">尚未生成波形预览音轨：请点击「刷新波形」</span>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-dark rounded-xl p-3">
      {loadError && (
        <div className="mb-2 text-xs text-red-300 whitespace-pre-wrap">
          <AlertCircle size={14} className="inline mr-1" />
          {loadError}
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  )
})

