/**
 * 功能模块：Studio 组件模块，负责 PreviewPlayer 的局部交互与可视化呈现
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Pause, Play, SkipBack, SkipForward, Video } from 'lucide-react'
import type { StudioShot } from '../../services/api'

interface PreviewPlayerProps {
  shots: StudioShot[]
  currentShotId: string | null
  onCurrentShotChange?: (shotId: string) => void
}

type VideoSlotIndex = 0 | 1

interface VideoSlotState {
  shotId: string | null
  src: string | null
}

const UI_PROGRESS_INTERVAL_MS = 100
const VIDEO_PRELOAD_THRESHOLD = 0.7

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
  const [videoSlots, setVideoSlots] = useState<[VideoSlotState, VideoSlotState]>([
    { shotId: null, src: null },
    { shotId: null, src: null },
  ])
  const [activeVideoSlot, setActiveVideoSlot] = useState<VideoSlotIndex>(0)
  const videoRef0 = useRef<HTMLVideoElement | null>(null)
  const videoRef1 = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const imagePlayStartRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const videoSlotsRef = useRef<[VideoSlotState, VideoSlotState]>(videoSlots)
  const activeVideoSlotRef = useRef<VideoSlotIndex>(activeVideoSlot)
  const slotReadyShotRef = useRef<[string | null, string | null]>([null, null])
  const currentShotIdRef = useRef<string | null>(null)
  const playingRef = useRef(false)
  const lastUiSyncTsRef = useRef(0)

  useEffect(() => {
    videoSlotsRef.current = videoSlots
  }, [videoSlots])

  useEffect(() => {
    activeVideoSlotRef.current = activeVideoSlot
  }, [activeVideoSlot])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const getVideoBySlot = useCallback((slot: VideoSlotIndex): HTMLVideoElement | null => {
    return slot === 0 ? videoRef0.current : videoRef1.current
  }, [])

  const cancelPlaybackLoop = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const syncElapsedForUi = useCallback((value: number, force = false, ts?: number) => {
    const safe = Math.max(0, value)
    elapsedRef.current = safe
    const now = ts ?? window.performance.now()
    if (force || now - lastUiSyncTsRef.current >= UI_PROGRESS_INTERVAL_MS) {
      lastUiSyncTsRef.current = now
      setElapsedInShot(safe)
    }
  }, [])

  const resetElapsed = useCallback((value: number = 0) => {
    imagePlayStartRef.current = null
    lastUiSyncTsRef.current = 0
    syncElapsedForUi(value, true)
  }, [syncElapsedForUi])

  const setVideoSlot = useCallback((slot: VideoSlotIndex, shotId: string | null, src: string | null) => {
    setVideoSlots((prev) => {
      const previous = prev[slot]
      if (previous.shotId === shotId && previous.src === src) return prev
      const next: [VideoSlotState, VideoSlotState] = [
        { ...prev[0] },
        { ...prev[1] },
      ]
      next[slot] = { shotId, src }
      slotReadyShotRef.current[slot] = null
      return next
    })
  }, [])

  const ensureCurrentVideoSlot = useCallback((shotId: string, src: string) => {
    const active = activeVideoSlotRef.current
    const inactive: VideoSlotIndex = active === 0 ? 1 : 0
    const slots = videoSlotsRef.current
    if (slots[active].shotId === shotId && slots[active].src === src) return
    if (
      slots[inactive].shotId === shotId &&
      slots[inactive].src === src &&
      slotReadyShotRef.current[inactive] === shotId
    ) {
      setActiveVideoSlot(inactive)
      return
    }
    setVideoSlot(inactive, shotId, src)
  }, [setVideoSlot])

  const preloadNextVideo = useCallback((fromIndex: number) => {
    const next = shots[fromIndex + 1]
    if (!next?.video_url) return
    const active = activeVideoSlotRef.current
    const inactive: VideoSlotIndex = active === 0 ? 1 : 0
    const slots = videoSlotsRef.current
    const matched =
      (slots[active].shotId === next.id && slots[active].src === next.video_url) ||
      (slots[inactive].shotId === next.id && slots[inactive].src === next.video_url)
    if (matched) return
    setVideoSlot(inactive, next.id, next.video_url)
  }, [setVideoSlot, shots])

  const goTo = useCallback((idx: number) => {
    if (!shots.length) return
    const next = Math.max(0, Math.min(shots.length - 1, idx))
    setIndex(next)
    resetElapsed(0)
  }, [resetElapsed, shots.length])

  const current = shots[index]

  useEffect(() => {
    currentShotIdRef.current = current?.id || null
  }, [current?.id])

  useEffect(() => {
    if (!shots.length) {
      setIndex(0)
      setPlaying(false)
      resetElapsed(0)
      return
    }
    if (index >= shots.length) {
      setIndex(shots.length - 1)
      resetElapsed(0)
      return
    }
    if (!currentShotId) return
    const idx = shots.findIndex((s) => s.id === currentShotId)
    if (idx >= 0 && idx !== index) {
      setIndex(idx)
      resetElapsed(0)
    }
  }, [shots, currentShotId, index, resetElapsed])

  useEffect(() => {
    if (!current || !onCurrentShotChange) return
    onCurrentShotChange(current.id)
  }, [current?.id, onCurrentShotChange])

  useEffect(() => {
    if (!current) return
    resetElapsed(0)
    if (current.video_url) {
      ensureCurrentVideoSlot(current.id, current.video_url)
    }
  }, [current?.id, current?.video_url, ensureCurrentVideoSlot, resetElapsed])

  useEffect(() => {
    cancelPlaybackLoop()
    if (!playing || !current) return

    const duration = normalizeDuration(Number(current.duration || 0))

    if (current.video_url) {
      const active = activeVideoSlotRef.current
      const activeMeta = videoSlotsRef.current[active]
      if (activeMeta.shotId !== current.id || activeMeta.src !== current.video_url) {
        return
      }
      const video = getVideoBySlot(active)
      if (!video) return
      void video.play().catch(() => undefined)
      const tick = (ts: number) => {
        const time = Math.max(0, video.currentTime || 0)
        syncElapsedForUi(time, false, ts)
        if (duration > 0 && (time / duration) >= VIDEO_PRELOAD_THRESHOLD) {
          preloadNextVideo(index)
        }
        if (playingRef.current && currentShotIdRef.current === current.id) {
          rafRef.current = window.requestAnimationFrame(tick)
        }
      }
      rafRef.current = window.requestAnimationFrame(tick)
      return () => cancelPlaybackLoop()
    }

    const tick = (ts: number) => {
      if (imagePlayStartRef.current == null) {
        imagePlayStartRef.current = ts - elapsedRef.current * 1000
      }
      const nextElapsed = Math.max(0, (ts - imagePlayStartRef.current) / 1000)
      if (duration > 0 && (nextElapsed / duration) >= VIDEO_PRELOAD_THRESHOLD) {
        preloadNextVideo(index)
      }
      if (nextElapsed >= duration) {
        syncElapsedForUi(duration, true, ts)
        imagePlayStartRef.current = null
        if (index < shots.length - 1) {
          setIndex((i) => i + 1)
          return
        }
        setPlaying(false)
        return
      }
      syncElapsedForUi(nextElapsed, false, ts)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      cancelPlaybackLoop()
    }
  }, [
    activeVideoSlot,
    cancelPlaybackLoop,
    current?.id,
    current?.video_url,
    current?.duration,
    getVideoBySlot,
    index,
    playing,
    preloadNextVideo,
    shots.length,
    syncElapsedForUi,
  ])

  useEffect(() => {
    const activeMeta = videoSlotsRef.current[activeVideoSlot]
    const shouldPlay = Boolean(
      playing &&
      current?.video_url &&
      activeMeta.shotId === current?.id &&
      activeMeta.src === current?.video_url,
    )
    const videoA = videoRef0.current
    const videoB = videoRef1.current
    if (videoA) {
      if (shouldPlay && activeVideoSlot === 0) void videoA.play().catch(() => undefined)
      else videoA.pause()
    }
    if (videoB) {
      if (shouldPlay && activeVideoSlot === 1) void videoB.play().catch(() => undefined)
      else videoB.pause()
    }
  }, [activeVideoSlot, current?.id, current?.video_url, playing])

  useEffect(() => () => {
    cancelPlaybackLoop()
  }, [cancelPlaybackLoop])

  const handleVideoLoadedData = useCallback((slot: VideoSlotIndex) => {
    const slotMeta = videoSlotsRef.current[slot]
    if (!slotMeta.shotId) return
    slotReadyShotRef.current[slot] = slotMeta.shotId
    const currentShotId = currentShotIdRef.current
    if (!currentShotId || slotMeta.shotId !== currentShotId) return
    const active = activeVideoSlotRef.current
    const activeMeta = videoSlotsRef.current[active]
    if (activeMeta.shotId !== currentShotId || active !== slot) {
      setActiveVideoSlot(slot)
    }
    const video = getVideoBySlot(slot)
    if (!video) return
    if (elapsedRef.current > 0) {
      try {
        const duration = Number.isFinite(video.duration) && video.duration > 0
          ? Math.max(0, video.duration - 0.05)
          : elapsedRef.current
        video.currentTime = Math.min(elapsedRef.current, duration)
      } catch {
        // ignore seek errors
      }
    }
    if (playingRef.current) {
      void video.play().catch(() => undefined)
    }
  }, [getVideoBySlot])

  const handleVideoTimeUpdate = useCallback((slot: VideoSlotIndex, currentTime: number) => {
    if (slot !== activeVideoSlotRef.current) return
    syncElapsedForUi(currentTime, false)
  }, [syncElapsedForUi])

  const handleVideoEnded = useCallback((slot: VideoSlotIndex) => {
    if (slot !== activeVideoSlotRef.current) return
    if (index < shots.length - 1) {
      goTo(index + 1)
      return
    }
    setPlaying(false)
  }, [goTo, index, shots.length])

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
          <>
            {current.start_image_url ? (
              <img
                src={current.start_image_url}
                alt={current.name || current.id}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-600">
                <ImageIcon className="w-10 h-10" />
              </div>
            )}
            <video
              ref={videoRef0}
              src={videoSlots[0].src || undefined}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${
                activeVideoSlot === 0 && videoSlots[0].shotId === current.id ? 'opacity-100' : 'opacity-0'
              }`}
              preload="auto"
              playsInline
              onLoadedData={() => handleVideoLoadedData(0)}
              onTimeUpdate={(event) => handleVideoTimeUpdate(0, event.currentTarget.currentTime)}
              onEnded={() => handleVideoEnded(0)}
            />
            <video
              ref={videoRef1}
              src={videoSlots[1].src || undefined}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${
                activeVideoSlot === 1 && videoSlots[1].shotId === current.id ? 'opacity-100' : 'opacity-0'
              }`}
              preload="auto"
              playsInline
              onLoadedData={() => handleVideoLoadedData(1)}
              onTimeUpdate={(event) => handleVideoTimeUpdate(1, event.currentTarget.currentTime)}
              onEnded={() => handleVideoEnded(1)}
            />
          </>
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
          className="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-[width] duration-100 ease-linear"
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
