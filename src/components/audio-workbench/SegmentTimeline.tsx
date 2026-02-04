import { useMemo, useRef } from 'react'
import type { AudioTimelineSegment } from '../../services/api'

const PX_PER_SEC = 42

function formatTime(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

export default function SegmentTimeline({
  segments,
  selectedShotId,
  onSelectShot,
  onSetDuration,
  durationLocked = false,
}: {
  segments: AudioTimelineSegment[]
  selectedShotId: string | null
  onSelectShot: (shotId: string) => void
  onSetDuration: (shotId: string, duration: number) => void
  durationLocked?: boolean
}) {
  const flat = useMemo(() => {
    const out: Array<{
      segment_id: string
      segment_name: string
      shot_id: string
      shot_name: string
      duration: number
      timecode_start: number
      timecode_end: number
      voice_duration_ms?: number
    }> = []
    for (const seg of segments || []) {
      for (const s of seg.shots || []) {
        out.push({
          segment_id: seg.segment_id,
          segment_name: seg.segment_name,
          shot_id: s.shot_id,
          shot_name: s.shot_name,
          duration: Number(s.duration) || 0,
          timecode_start: Number(s.timecode_start) || 0,
          timecode_end: Number(s.timecode_end) || 0,
          voice_duration_ms: s.voice_duration_ms,
        })
      }
    }
    return out
  }, [segments])

  const dragRef = useRef<null | { shotId: string; startX: number; startDuration: number }>(null)
  const canEdit = !durationLocked

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-200">{canEdit ? '时间轴（拖拽右侧边调整时长）' : '时间轴（视频已生成：时长已锁定）'}</h3>
        <span className="text-[11px] text-gray-500">比例：{PX_PER_SEC}px / 秒</span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex items-stretch gap-2 min-h-[84px]">
          {flat.map((s) => {
            const w = Math.max(56, (Number.isFinite(s.duration) ? s.duration : 0) * PX_PER_SEC)
            const selected = selectedShotId === s.shot_id
            const voiceMs = Number(s.voice_duration_ms) || 0
            const voiceSec = voiceMs > 0 ? voiceMs / 1000 : 0
            const tooShort = voiceSec > 0.01 && s.duration + 1e-6 < voiceSec

            return (
              <div
                key={s.shot_id}
                className={`relative rounded-xl border transition-apple select-none ${
                  selected ? 'border-primary/70 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                } ${tooShort ? 'ring-2 ring-yellow-400/50' : ''}`}
                style={{ width: `${w}px` }}
                onClick={() => onSelectShot(s.shot_id)}
                title={`${s.segment_name} / ${s.shot_name}\n${formatTime(s.timecode_start)} - ${formatTime(s.timecode_end)}\n时长 ${s.duration}s${voiceSec ? ` · 人声 ${voiceSec.toFixed(2)}s` : ''}`}
              >
                <div className="px-3 py-2">
                  <div className="text-[11px] text-gray-400">{formatTime(s.timecode_start)}</div>
                  <div className="text-sm font-medium text-gray-200 truncate">{s.shot_name}</div>
                  <div className="text-[11px] text-gray-400">
                    {s.duration.toFixed(1)}s{voiceSec ? ` · voice ${voiceSec.toFixed(1)}s` : ''}
                  </div>
                </div>

                {/* drag handle */}
                {canEdit && (
                  <div
                    className="absolute top-1 bottom-1 right-0 w-2 cursor-ew-resize rounded-r-xl hover:bg-primary/40"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                      dragRef.current = { shotId: s.shot_id, startX: e.clientX, startDuration: s.duration }
                    }}
                    onPointerMove={(e) => {
                      const st = dragRef.current
                      if (!st) return
                      if (st.shotId !== s.shot_id) return
                      const deltaPx = e.clientX - st.startX
                      const deltaSec = deltaPx / PX_PER_SEC
                      onSetDuration(s.shot_id, st.startDuration + deltaSec)
                    }}
                    onPointerUp={(e) => {
                      try {
                        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                      } catch {
                        // ignore
                      }
                      dragRef.current = null
                    }}
                    onPointerCancel={() => {
                      dragRef.current = null
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
