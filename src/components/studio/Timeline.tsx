import { useMemo, useState } from 'react'
import { GripVertical, ImageIcon, Music2, Video } from 'lucide-react'
import type { StudioShot } from '../../services/api'

interface TimelineProps {
  shots: StudioShot[]
  currentShotId: string | null
  onSelectShot: (shotId: string) => void
  onReorder?: (orderedShotIds: string[]) => void | Promise<void>
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

function TimelineHoverOverview({ shot }: { shot: StudioShot }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[130] flex items-center justify-center px-4 py-8 opacity-0 scale-[0.97] transition-all duration-150 delay-0 group-hover:delay-700 group-hover:opacity-100 group-hover:scale-100">
      <div className="w-full max-w-4xl rounded-xl border border-gray-600 bg-gray-950/95 p-4 shadow-2xl backdrop-blur-sm">
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
            <div className="aspect-video w-full bg-gray-900/80">
              {shot.start_image_url ? (
                <img src={shot.start_image_url} alt={shot.name || shot.id} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  <ImageIcon className="w-10 h-10" />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-base text-gray-100 font-semibold line-clamp-2">{shot.name || '未命名镜头'}</p>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{shot.type || 'standard'}</span>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed line-clamp-6">
              {shot.narration || shot.description || '暂无描述'}
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
                <span>资源</span>
                <span>{shot.video_url ? '视频就绪' : '视频未生成'} · {shot.audio_url ? '音频就绪' : '音频未生成'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Timeline({
  shots,
  currentShotId,
  onSelectShot,
  onReorder,
}: TimelineProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const totalDuration = useMemo(
    () => shots.reduce((sum, shot) => sum + normalizeDuration(Number(shot.duration || 0)), 0),
    [shots]
  )

  const cumulative = useMemo(() => {
    let cursor = 0
    return shots.map((shot) => {
      const duration = normalizeDuration(Number(shot.duration || 0))
      const start = cursor
      cursor += duration
      return { shotId: shot.id, start, duration, end: cursor }
    })
  }, [shots])

  const handleDrop = async (targetId: string) => {
    if (!draggingId || draggingId === targetId || !onReorder || reordering) return
    const ids = shots.map((s) => s.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = ids.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    setReordering(true)
    try {
      await onReorder(next)
    } finally {
      setReordering(false)
      setDraggingId(null)
    }
  }

  return (
    <div className="h-full p-3 min-h-0 flex flex-col gap-2">
      <div className="flex items-center justify-between shrink-0">
        <div className="text-xs text-gray-400">轨道时间线</div>
        <div className="text-xs text-gray-500">
          总时长 {formatSec(totalDuration)} · {shots.length} 镜头
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-gray-800 bg-gray-950/60 p-3 flex flex-col gap-2">
        <div className="text-[11px] text-gray-500 shrink-0">
          拖拽镜头块可重排；点击镜头块可跳转预览
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-1">
          <div className="min-w-full w-max pr-1 space-y-2">
            <div className="flex items-center gap-2 min-w-max">
              <Video className="w-3.5 h-3.5 text-purple-300 shrink-0" />
              <div className="flex items-stretch gap-1 min-h-11">
                {shots.map((shot) => {
                  const widthPercent = totalDuration > 0
                    ? (normalizeDuration(Number(shot.duration || 0)) / totalDuration) * 100
                    : 100 / Math.max(1, shots.length)
                  const isCurrent = shot.id === currentShotId
                  const baseClass = isCurrent
                    ? 'border-purple-400 bg-purple-900/40 text-purple-100'
                    : 'border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500'

                  return (
                    <button
                      key={shot.id}
                      draggable={!reordering}
                      onDragStart={() => setDraggingId(shot.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        void handleDrop(shot.id)
                      }}
                      onClick={() => onSelectShot(shot.id)}
                      style={{
                        width: `${Math.max(widthPercent, 8)}%`,
                        minWidth: 84,
                      }}
                      className={`group relative border rounded px-1.5 py-1 text-[11px] transition-colors ${baseClass}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="truncate">{shot.name || '未命名镜头'}</span>
                        <GripVertical className="w-3 h-3 text-gray-500 opacity-60 group-hover:opacity-100 shrink-0" />
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {shot.video_url ? '视频已生成' : '快速预览'}
                      </div>
                      <TimelineHoverOverview shot={shot} />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 min-w-max">
              <Music2 className="w-3.5 h-3.5 text-blue-300 shrink-0" />
              <div className="flex items-stretch gap-1 min-h-7">
                {shots.map((shot) => {
                  const widthPercent = totalDuration > 0
                    ? (normalizeDuration(Number(shot.duration || 0)) / totalDuration) * 100
                    : 100 / Math.max(1, shots.length)
                  const hasAudio = Boolean(shot.audio_url)
                  return (
                    <div
                      key={`${shot.id}_audio`}
                      style={{
                        width: `${Math.max(widthPercent, 8)}%`,
                        minWidth: 84,
                      }}
                      className={`rounded border px-1.5 py-1 text-[10px] truncate ${
                        hasAudio
                          ? 'border-blue-700/70 bg-blue-900/30 text-blue-200'
                          : 'border-gray-800 bg-gray-900 text-gray-500'
                      }`}
                    >
                      {hasAudio ? '音频可用' : '无音频'}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="relative h-6 border-t border-gray-800 pt-1">
              <div className="absolute inset-x-0 top-1 flex items-center justify-between text-[10px] text-gray-600">
                <span>00:00</span>
                <span>{formatSec(totalDuration / 2)}</span>
                <span>{formatSec(totalDuration)}</span>
              </div>
              {currentShotId && (
                <div className="absolute inset-x-0 bottom-0 text-[10px] text-gray-400">
                  {(() => {
                    const cur = cumulative.find((c) => c.shotId === currentShotId)
                    if (!cur) return null
                    return `当前镜头区间 ${formatSec(cur.start)} - ${formatSec(cur.end)}`
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
