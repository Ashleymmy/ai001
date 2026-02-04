import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Film, Minus, Plus } from 'lucide-react'
import MiniWaveform from './MiniWaveform'
import type { AudioTimelineShot } from '../../services/api'

type MediaInfo = {
  start_image_url?: string
  video_url?: string
  status?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getShotMedia(mediaByShotId: Record<string, MediaInfo> | undefined, shotId: string) {
  const m = mediaByShotId?.[shotId]
  return m && typeof m === 'object' ? m : undefined
}

export default function MultiTrackTimeline({
  shots,
  totalDuration,
  currentTime,
  selectedShotId,
  mediaByShotId,
  onSelectShot,
  onSeek,
  resolveMediaUrl,
}: {
  shots: Array<AudioTimelineShot & { segment_name?: string }>
  totalDuration: number
  currentTime: number
  selectedShotId: string | null
  mediaByShotId?: Record<string, MediaInfo>
  onSelectShot: (shotId: string) => void
  onSeek: (seconds: number) => void
  resolveMediaUrl: (url?: string | null) => string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pxPerSec, setPxPerSec] = useState<number>(() => {
    const raw = localStorage.getItem('audio_workbench_px_per_sec')
    const v = raw ? Number(raw) : 42
    return Number.isFinite(v) && v > 10 ? v : 42
  })

  useEffect(() => {
    localStorage.setItem('audio_workbench_px_per_sec', String(pxPerSec))
  }, [pxPerSec])

  const d = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 0
  const contentWidth = Math.max(420, Math.ceil(d * pxPerSec))

  const secondsMarks = useMemo(() => {
    const out: number[] = []
    const total = Math.floor(d)
    for (let s = 0; s <= total; s++) out.push(s)
    return out
  }, [d])

  const playheadLeft = clamp(currentTime, 0, d) * pxPerSec

  const laneHeights = {
    ruler: 24,
    shots: 58,
    audio: 44,
  }
  const totalHeight = laneHeights.ruler + laneHeights.shots + laneHeights.audio * 3

  const handleClickSeek = (e: MouseEvent) => {
    const scroller = scrollRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const x = e.clientX - rect.left + scroller.scrollLeft
    const t = x / pxPerSec
    onSeek(t)
  }

  return (
    <div className="glass-dark rounded-xl p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[11px] text-gray-500 flex items-center gap-2">
          <Film size={14} className="text-gray-400" />
          <span>比例: {pxPerSec}px / 秒</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPxPerSec((p) => clamp(p - 8, 16, 120))}
            className="p-2 glass-button rounded-lg"
            title="缩小"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => setPxPerSec((p) => clamp(p + 8, 16, 120))}
            className="p-2 glass-button rounded-lg"
            title="放大"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[88px_1fr] gap-2">
        <div className="text-[11px] text-gray-500 select-none">
          <div style={{ height: laneHeights.ruler }} className="flex items-center">
            时间
          </div>
          <div style={{ height: laneHeights.shots }} className="flex items-center">
            镜头
          </div>
          <div style={{ height: laneHeights.audio }} className="flex items-center">
            旁白
          </div>
          <div style={{ height: laneHeights.audio }} className="flex items-center">
            对白
          </div>
          <div style={{ height: laneHeights.audio }} className="flex items-center">
            音效
          </div>
        </div>

        <div
          ref={scrollRef}
          className="overflow-x-auto rounded-lg border border-white/10"
          onClick={handleClickSeek}
        >
          <div className="relative" style={{ width: contentWidth, height: totalHeight }}>
            <div
              className="absolute top-0 bottom-0 w-px bg-pink-400/70 pointer-events-none"
              style={{ left: playheadLeft }}
            />

            {/* ruler */}
            <div style={{ height: laneHeights.ruler }} className="relative border-b border-white/10">
              {secondsMarks.map((s) => {
                const left = s * pxPerSec
                const major = s % 5 === 0
                return (
                  <div key={s} className="absolute top-0 bottom-0" style={{ left }}>
                    <div className={`w-px ${major ? 'h-full bg-white/15' : 'h-2/3 bg-white/8'}`} />
                    {major && (
                      <div className="absolute -top-0.5 left-1 text-[10px] text-gray-500 font-mono">
                        {s}s
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* shots lane */}
            <div style={{ height: laneHeights.shots }} className="relative border-b border-white/10">
              {shots.map((s) => {
                const left = (Number(s.timecode_start) || 0) * pxPerSec
                const width = Math.max(8, (Number(s.duration) || 0) * pxPerSec)
                const selected = selectedShotId === s.shot_id
                const m = getShotMedia(mediaByShotId, s.shot_id)
                const thumbUrl = resolveMediaUrl(m?.start_image_url || '')
                const hasVideo = Boolean((m?.video_url || '').trim())
                return (
                  <button
                    key={s.shot_id}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onSelectShot(s.shot_id)
                    }}
                    className={`absolute top-1 bottom-1 rounded-lg overflow-hidden border ${
                      selected ? 'border-pink-400/60 bg-pink-500/10' : 'border-white/10 bg-white/5 hover:bg-white/8'
                    }`}
                    style={{ left, width }}
                    title={`${s.shot_name} · ${s.shot_id}${s.segment_name ? ` · ${s.segment_name}` : ''}`}
                  >
                    <div className="h-full flex items-center gap-2 px-2">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-10 h-10 object-cover rounded-md opacity-90" />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-gray-500">
                          —
                        </div>
                      )}
                      <div className="min-w-0 text-left">
                        <div className="text-[11px] text-gray-100 font-medium truncate">
                          {s.shot_name}
                          {hasVideo ? <span className="ml-1 text-[10px] text-green-300">●</span> : null}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono truncate">{s.shot_id}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* narration lane */}
            <div style={{ height: laneHeights.audio }} className="relative border-b border-white/10">
              {shots.map((s) => {
                const url = resolveMediaUrl(s.narration_audio_url || '')
                if (!url) return null
                const durMs = Number(s.narration_duration_ms) || 0
                const dur = durMs > 0 ? durMs / 1000 : 0
                const left = (Number(s.timecode_start) || 0) * pxPerSec
                const width = Math.max(10, Math.min(Number(s.duration) || 0, dur || Number(s.duration) || 0) * pxPerSec)
                const selected = selectedShotId === s.shot_id
                return (
                  <div
                    key={s.shot_id}
                    className={`absolute top-1 bottom-1 rounded-lg border ${selected ? 'border-pink-400/50 bg-pink-500/5' : 'border-white/10 bg-white/5'}`}
                    style={{ left, width }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectShot(s.shot_id)
                    }}
                    title={`旁白 · ${s.shot_name}`}
                  >
                    <MiniWaveform url={url} className="w-full h-full" color="rgba(147,197,253,0.75)" height={laneHeights.audio - 8} />
                  </div>
                )
              })}
            </div>

            {/* dialogue lane */}
            <div style={{ height: laneHeights.audio }} className="relative border-b border-white/10">
              {shots.map((s) => {
                const url = resolveMediaUrl(s.dialogue_audio_url || '')
                if (!url) return null
                const durMs = Number(s.dialogue_duration_ms) || 0
                const dur = durMs > 0 ? durMs / 1000 : 0
                const left = (Number(s.timecode_start) || 0) * pxPerSec
                const width = Math.max(10, Math.min(Number(s.duration) || 0, dur || Number(s.duration) || 0) * pxPerSec)
                const selected = selectedShotId === s.shot_id
                return (
                  <div
                    key={s.shot_id}
                    className={`absolute top-1 bottom-1 rounded-lg border ${selected ? 'border-pink-400/50 bg-pink-500/5' : 'border-white/10 bg-white/5'}`}
                    style={{ left, width }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectShot(s.shot_id)
                    }}
                    title={`对白 · ${s.shot_name}`}
                  >
                    <MiniWaveform url={url} className="w-full h-full" color="rgba(34,197,94,0.7)" height={laneHeights.audio - 8} />
                  </div>
                )
              })}
            </div>

            {/* sfx lane (placeholder) */}
            <div style={{ height: laneHeights.audio }} className="relative">
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-600">
                （音效轨：后续支持上传/修复片段）
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
