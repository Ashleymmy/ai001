/**
 * 功能模块：Studio 组件模块，负责 HoverMediaPreview 的局部交互与可视化呈现
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Video } from 'lucide-react'
import type { StudioShot } from '../../services/api'

type HoverMediaPreviewShot = Pick<
  StudioShot,
  'id' | 'name' | 'type' | 'status' | 'duration' | 'description' | 'narration' | 'dialogue_script' | 'prompt' | 'video_prompt' | 'start_image_url' | 'end_image_url' | 'video_url' | 'audio_url'
>

/** Preset preview window sizes (width x height for landscape 16:9 content) */
type PreviewSizePreset = 'small' | 'medium' | 'large'

const PREVIEW_SIZE_MAP: Record<PreviewSizePreset, { w: number; h: number }> = {
  small:  { w: 240, h: 180 },
  medium: { w: 320, h: 240 },
  large:  { w: 480, h: 360 },
}

interface HoverMediaPreviewProps {
  active: boolean
  shot: HoverMediaPreviewShot
  index?: number
  maxWidthClass?: string
  openDelayMs?: number
  videoDelayMs?: number
  /** Adaptive preview window size preset (default: 'medium') */
  previewSize?: PreviewSizePreset
  /** Aspect ratio hint – e.g. '9:16' or 'vertical'. When vertical, width/height are swapped. */
  aspectRatio?: string
  /** Shot index shown in the info overlay (0-based, displayed as 1-based) */
  shotIndex?: number
  /** Duration text shown in the info overlay (overrides shot.duration when provided) */
  durationText?: string
  /** Camera movement label shown in the info overlay */
  cameraMovement?: string
  /** URL to preload (typically the next shot's video) for faster playback */
  preloadSrc?: string
}

export default function HoverMediaPreview({
  active,
  shot,
  index,
  maxWidthClass = 'max-w-5xl',
  openDelayMs = 800,
  videoDelayMs = 800,
  previewSize = 'medium',
  aspectRatio,
  shotIndex,
  durationText,
  cameraMovement,
  preloadSrc,
}: HoverMediaPreviewProps) {
  const [visible, setVisible] = useState(false)
  const [videoVisible, setVideoVisible] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const videoTimerRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  /* ---- Enhancement 1: Adaptive window size ---- */
  const isVertical = useMemo(() => {
    if (!aspectRatio) return false
    const lower = aspectRatio.toLowerCase().trim()
    if (lower === 'vertical' || lower === 'portrait') return true
    // Parse ratio strings like '9:16' or '9/16'
    const m = lower.match(/^(\d+(?:\.\d+)?)\s*[:\/]\s*(\d+(?:\.\d+)?)$/)
    if (m) {
      const w = parseFloat(m[1])
      const h = parseFloat(m[2])
      return h > w
    }
    return false
  }, [aspectRatio])

  const previewDimensions = useMemo(() => {
    const base = PREVIEW_SIZE_MAP[previewSize] || PREVIEW_SIZE_MAP.medium
    // For vertical content, swap width and height
    return isVertical ? { w: base.h, h: base.w } : base
  }, [previewSize, isVertical])

  const narrationPreview = useMemo(
    () => (shot.narration || shot.description || '').trim(),
    [shot.narration, shot.description],
  )

  useEffect(() => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (videoTimerRef.current) {
      window.clearTimeout(videoTimerRef.current)
      videoTimerRef.current = null
    }

    if (!active) {
      setVisible(false)
      setVideoVisible(false)
      return
    }

    openTimerRef.current = window.setTimeout(() => {
      setVisible(true)
    }, Math.max(0, openDelayMs))

    if (shot.video_url) {
      videoTimerRef.current = window.setTimeout(() => {
        setVideoVisible(true)
      }, Math.max(0, openDelayMs + videoDelayMs))
    } else {
      setVideoVisible(false)
    }

    return () => {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
      if (videoTimerRef.current) {
        window.clearTimeout(videoTimerRef.current)
        videoTimerRef.current = null
      }
    }
  }, [active, shot.id, shot.video_url, openDelayMs, videoDelayMs])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (active && visible && videoVisible && shot.video_url) {
      void video.play().catch(() => undefined)
      return
    }
    video.pause()
    video.currentTime = 0
  }, [active, visible, videoVisible, shot.video_url])

  /* ---- Enhancement 3: Preloading strategy ---- */
  useEffect(() => {
    if (!preloadSrc) return

    // Determine if the source is a video or image based on extension
    const isVideo = /\.(mp4|webm|mov|ogg)(\?|$)/i.test(preloadSrc)
    let cleanup: (() => void) | undefined

    if (isVideo) {
      // Use a hidden video element for video preloading
      const vid = document.createElement('video')
      vid.preload = 'auto'
      vid.muted = true
      vid.style.display = 'none'
      vid.src = preloadSrc
      document.body.appendChild(vid)
      cleanup = () => {
        vid.src = ''
        vid.load()
        document.body.removeChild(vid)
      }
    } else {
      // Use a <link rel="preload"> for images / other resources
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = isVideo ? 'video' : 'image'
      link.href = preloadSrc
      document.head.appendChild(link)
      cleanup = () => {
        document.head.removeChild(link)
      }
    }

    return cleanup
  }, [preloadSrc])

  if (!active && !visible) return null

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[130] flex items-center justify-center px-4 py-8 transition-all duration-200 ${
        visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.97]'
      }`}
    >
      <div className={`w-full ${maxWidthClass} rounded-xl border border-gray-600 bg-gray-950/95 p-4 shadow-2xl backdrop-blur-sm`}>
        <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-2">
            <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
              <div
                className="relative w-full bg-gray-900/80"
                style={{ maxWidth: previewDimensions.w, aspectRatio: `${previewDimensions.w} / ${previewDimensions.h}` }}
              >
                {shot.start_image_url ? (
                  <img src={shot.start_image_url} alt={shot.name || shot.id} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-600">
                    <ImageIcon className="w-10 h-10" />
                  </div>
                )}

                {shot.video_url && (
                  <video
                    ref={videoRef}
                    key={`${shot.id}_${shot.video_url}`}
                    src={shot.video_url}
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                      videoVisible ? 'opacity-100' : 'opacity-0'
                    }`}
                    muted
                    playsInline
                    loop
                  />
                )}

                <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/60 text-gray-200 flex items-center gap-1">
                  {shot.video_url && videoVisible ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                  {shot.video_url ? (videoVisible ? '视频预览' : '图片预览（视频待触发）') : '图片预览'}
                </div>

                {/* Enhancement 2: Info overlay */}
                {(typeof shotIndex === 'number' || durationText || shot.duration || cameraMovement) && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-2 py-1 flex items-center gap-2 text-white text-[10px]">
                    {typeof shotIndex === 'number' && (
                      <span className="font-medium">#{shotIndex + 1}</span>
                    )}
                    {(durationText || shot.duration) && (
                      <span>{durationText || `${shot.duration}s`}</span>
                    )}
                    {cameraMovement && (
                      <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5">{cameraMovement}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            {shot.end_image_url && (
              <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
                <div className="aspect-video w-full bg-gray-900/80">
                  <img src={shot.end_image_url} alt={`${shot.name || '镜头'}-end`} className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base text-gray-100 font-semibold line-clamp-2">
                {typeof index === 'number' ? `#${index + 1} ` : ''}{shot.name || '未命名镜头'}
              </p>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{shot.type || 'standard'}</span>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed line-clamp-7">
              {narrationPreview || '暂无描述'}
            </p>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-gray-400">
                <span>状态</span>
                <span>{shot.status || 'pending'}</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>时长</span>
                <span>{shot.duration || 0}s</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>首帧</span>
                <span>{shot.start_image_url ? '已生成' : '未生成'}</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>视频/音频</span>
                <span>{shot.video_url ? '视频就绪' : '视频未生成'} · {shot.audio_url ? '音频就绪' : '音频未生成'}</span>
              </div>
            </div>
            {(shot.dialogue_script || shot.prompt || shot.video_prompt) && (
              <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-2.5">
                <p className="text-xs text-gray-500 mb-1">补充信息</p>
                <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">
                  {shot.dialogue_script || shot.video_prompt || shot.prompt}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
