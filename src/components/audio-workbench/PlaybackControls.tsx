import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'

function formatTime(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

export default function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  disablePlayback,
  onPlayPause,
  onSeek,
  onPrevShot,
  onNextShot,
  onPlayShot,
}: {
  isPlaying: boolean
  currentTime: number
  duration: number
  disablePlayback?: boolean
  onPlayPause: () => void
  onSeek: (t: number) => void
  onPrevShot: () => void
  onNextShot: () => void
  onPlayShot: () => void
}) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0
  const t = Math.max(0, Math.min(d || 0, Number.isFinite(currentTime) ? currentTime : 0))

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 font-mono w-16">{formatTime(t)}</span>
        <input
          type="range"
          min={0}
          max={d || 1}
          step={0.05}
          value={d ? t : 0}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={!d || disablePlayback}
          className="flex-1 accent-primary disabled:opacity-40"
        />
        <span className="text-xs text-gray-400 font-mono w-16 text-right">{formatTime(d)}</span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onPrevShot}
          className="p-2 glass-button rounded-xl"
          title="上一个镜头"
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={disablePlayback}
          className="px-4 py-2 gradient-primary rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"
          title={disablePlayback ? '请先刷新波形预览音轨' : '播放/暂停'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          {isPlaying ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          onClick={onPlayShot}
          disabled={disablePlayback}
          className="px-3 py-2 glass-button rounded-xl text-sm disabled:opacity-40"
          title={disablePlayback ? '请先刷新波形预览音轨' : '播放选中镜头片段'}
        >
          播放本镜头
        </button>
        <button
          type="button"
          onClick={onNextShot}
          className="p-2 glass-button rounded-xl"
          title="下一个镜头"
        >
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  )
}

