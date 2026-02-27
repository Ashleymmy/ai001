import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Pause, Play, SkipBack, SkipForward, Video } from 'lucide-react'
import type { StudioShot } from '../../services/api'

interface PreviewPlayerProps {
  shots: StudioShot[]
  currentShotId: string | null
  onCurrentShotChange?: (shotId: string) => void
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.max(1, value)
}

function formatSec(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PreviewPlayer({
  shots,
  currentShotId,
  onCurrentShotChange,
}: PreviewPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [elapsedInShot, setElapsedInShot] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const imagePlayStartRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    elapsedRef.current = elapsedInShot
  }, [elapsedInShot])

  useEffect(() => {
    if (!shots.length) {
      setIndex(0)
      setPlaying(false)
      setElapsedInShot(0)
      return
    }
    if (!currentShotId) return
    const idx = shots.findIndex((s) => s.id === currentShotId)
    if (idx >= 0) {
      setIndex(idx)
      setElapsedInShot(0)
      elapsedRef.current = 0
      imagePlayStartRef.current = null
    }
  }, [shots, currentShotId])

  const current = shots[index]

  useEffect(() => {
    if (!current || !onCurrentShotChange) return
    onCurrentShotChange(current.id)
  }, [current?.id, onCurrentShotChange])

  useEffect(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (!playing || !current || current.video_url) {
      imagePlayStartRef.current = null
      return
    }

    const duration = normalizeDuration(Number(current.duration || 0))

    const tick = (ts: number) => {
      if (imagePlayStartRef.current == null) {
        imagePlayStartRef.current = ts - elapsedRef.current * 1000
      }
      const nextElapsed = Math.max(0, (ts - imagePlayStartRef.current) / 1000)
      if (nextElapsed >= duration) {
        if (index < shots.length - 1) {
          setIndex((i) => i + 1)
          setElapsedInShot(0)
          elapsedRef.current = 0
          imagePlayStartRef.current = null
          return
        }
        setElapsedInShot(duration)
        elapsedRef.current = duration
        imagePlayStartRef.current = null
        setPlaying(false)
        return
      }
      setElapsedInShot(nextElapsed)
      elapsedRef.current = nextElapsed
      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [playing, current?.id, current?.video_url, index, shots.length])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [playing, current?.video_url])

  useEffect(() => {
    if (!current?.video_url) return
    setElapsedInShot(0)
    elapsedRef.current = 0
    imagePlayStartRef.current = null
  }, [current?.id, current?.video_url])

  useEffect(() => () => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const timeline = useMemo(() => {
    let cursor = 0
    return shots.map((shot) => {
      const start = cursor
      cursor += normalizeDuration(Number(shot.duration || 0))
      return { shotId: shot.id, start, end: cursor }
    })
  }, [shots])
  const totalDuration = timeline.length ? timeline[timeline.length - 1].end : 0
  const currentRange = current ? timeline.find((seg) => seg.shotId === current.id) : null
  const currentTime = (currentRange?.start || 0) + elapsedInShot

  if (!shots.length || !current) {
    return (
      <div className="h-full rounded-lg border border-gray-800 bg-gray-950/60 flex items-center justify-center text-sm text-gray-500">
        暂无镜头可预览
      </div>
    )
  }

  const goTo = (idx: number) => {
    const next = Math.max(0, Math.min(shots.length - 1, idx))
    setIndex(next)
    setElapsedInShot(0)
    elapsedRef.current = 0
    imagePlayStartRef.current = null
  }

  const duration = normalizeDuration(Number(current.duration || 0))
  const progress = Math.min(100, Math.max(0, (elapsedInShot / duration) * 100))
  const hasVideo = Boolean(current.video_url)
  const subtitle = (current.narration || current.dialogue_script || '').trim()

  return (
    <div className="h-full p-3 min-h-0 flex flex-col gap-2">
      <div className="flex items-center justify-between shrink-0">
        <div className="text-xs text-gray-400">预览播放器</div>
        <div className="text-xs text-gray-500">
          {formatSec(currentTime)} / {formatSec(totalDuration)}
        </div>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-gray-800 bg-black flex-1 min-h-[120px]">
        {hasVideo ? (
          <video
            key={`${current.id}_${current.video_url}`}
            ref={videoRef}
            src={current.video_url}
            className="w-full h-full object-cover"
            playsInline
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime
              setElapsedInShot(time)
              elapsedRef.current = time
            }}
            onEnded={() => {
              if (index < shots.length - 1) {
                goTo(index + 1)
              } else {
                setPlaying(false)
              }
            }}
          />
        ) : current.start_image_url ? (
          <img
            src={current.start_image_url}
            alt={current.name || current.id}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <ImageIcon className="w-10 h-10" />
          </div>
        )}

        <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/60 text-gray-200 flex items-center gap-1">
          {hasVideo ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
          {hasVideo ? '视频预览' : '快速预览（帧+字幕）'}
        </div>

        {subtitle && (
          <div className="absolute inset-x-2 bottom-2 text-xs text-white bg-black/50 px-2 py-1 rounded line-clamp-3">
            {subtitle}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 flex items-center justify-between shrink-0">
        <span className="truncate mr-2">{current.name || '未命名镜头'}</span>
        <span>{duration.toFixed(1)}s</span>
      </div>

      <div className="h-1.5 rounded bg-gray-800 overflow-hidden shrink-0">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 shrink-0">
        <button
          onClick={() => goTo(index - 1)}
          className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
          title="上一镜头"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setPlaying((v) => !v)}
          className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs flex items-center gap-1.5"
          title={playing ? '暂停' : '播放'}
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? '暂停' : '播放'}
        </button>
        <button
          onClick={() => goTo(index + 1)}
          className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
          title="下一镜头"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
