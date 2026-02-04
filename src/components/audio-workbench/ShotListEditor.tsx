import type { AudioTimelineSegment } from '../../services/api'

function formatTime(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

export default function ShotListEditor({
  segments,
  selectedShotId,
  onSelectShot,
  onSetDuration,
  onPlayShot,
  durationLocked = false,
}: {
  segments: AudioTimelineSegment[]
  selectedShotId: string | null
  onSelectShot: (shotId: string) => void
  onSetDuration: (shotId: string, duration: number) => void
  onPlayShot: (shotId: string) => void
  durationLocked?: boolean
}) {
  const rows = (segments || []).flatMap((seg) =>
    (seg.shots || []).map((s) => ({
      segment_id: seg.segment_id,
      segment_name: seg.segment_name,
      ...s,
    }))
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-200">镜头列表</h3>
        <span className="text-[11px] text-gray-500">{rows.length} 镜头</span>
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-black/30">
            <tr className="text-gray-400">
              <th className="text-left font-medium py-2 px-2">镜头</th>
              <th className="text-left font-medium py-2 px-2">Timecode</th>
              <th className="text-left font-medium py-2 px-2">时长</th>
              <th className="text-left font-medium py-2 px-2">人声</th>
              <th className="text-right font-medium py-2 px-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const selected = selectedShotId === s.shot_id
              const voiceMs = Number(s.voice_duration_ms) || 0
              const voiceSec = voiceMs > 0 ? voiceMs / 1000 : 0
              const dur = Number(s.duration) || 0
              const tooShort = voiceSec > 0.01 && dur + 1e-6 < voiceSec
              const tooLong = dur > 10
              return (
                <tr
                  key={s.shot_id}
                  className={`border-t border-white/5 ${selected ? 'bg-white/10' : 'hover:bg-white/5'} ${
                    tooShort ? 'ring-1 ring-yellow-400/40' : ''
                  }`}
                  onClick={() => onSelectShot(s.shot_id)}
                >
                  <td className="py-2 px-2">
                    <div className="text-gray-200 font-medium">{s.shot_name}</div>
                    <div className="text-[10px] text-gray-500 truncate" title={s.segment_name}>
                      {s.segment_name}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-gray-300 font-mono">
                    {formatTime(Number(s.timecode_start) || 0)}–{formatTime(Number(s.timecode_end) || 0)}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      step={0.5}
                      min={2}
                      value={dur}
                      disabled={durationLocked}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        onSetDuration(s.shot_id, v)
                      }}
                      className={`w-20 glass-dark rounded-lg px-2 py-1 text-xs text-gray-200 border focus:outline-none ${
                        tooShort ? 'border-yellow-400/60' : tooLong ? 'border-purple-400/40' : 'border-white/10'
                      }`}
                      title={durationLocked ? '视频已生成：镜头时长已锁定' : tooLong ? '>10s 可能降低 AI 视频质量，建议拆分' : '步进 0.5s，最小 2s'}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="ml-1 text-gray-500">s</span>
                  </td>
                  <td className="py-2 px-2">
                    {voiceSec > 0 ? (
                      <span className={`font-mono ${tooShort ? 'text-yellow-300' : 'text-gray-300'}`}>{voiceSec.toFixed(2)}s</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onPlayShot(s.shot_id)
                      }}
                      className="px-2 py-1 glass-button rounded-lg text-[11px]"
                      title="播放该镜头片段（需要先刷新波形）"
                    >
                      播放
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
