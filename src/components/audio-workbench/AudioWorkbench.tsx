import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import type { AudioTimeline, AudioTimelineShot } from '../../services/api'
import {
  generateAgentAudio,
  generateAudioTimelineMasterAudio,
  getAgentAudioTimeline,
  saveAgentAudioTimeline,
} from '../../services/api'
import PlaybackControls from './PlaybackControls'
import SegmentTimeline from './SegmentTimeline'
import ShotListEditor from './ShotListEditor'
import WaveformDisplay, { type WaveformHandle } from './WaveformDisplay'

function resolveMediaUrl(url?: string | null) {
  const u = (url || '').trim()
  if (!u) return ''
  if (/^(data:|blob:)/i.test(u)) return u
  if (/^https?:/i.test(u)) return u
  if (u.startsWith('/api/')) return `http://localhost:8000${u}`
  return u
}

function formatTime(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

function ceilToHalf(value: number) {
  const v = Number.isFinite(value) ? value : 0
  return Math.ceil(Math.max(0, v) * 2) / 2
}

function buildShotDurationMap(tl: AudioTimeline) {
  const out: Record<string, number> = {}
  for (const seg of tl.segments || []) {
    for (const shot of seg.shots || []) {
      out[shot.shot_id] = Number(shot.duration) || 0
    }
  }
  return out
}

function rebuildTimecodes(tl: AudioTimeline): AudioTimeline {
  let t = 0
  const nextSegments = (tl.segments || []).map((seg) => {
    const shots = (seg.shots || []).map((shot) => {
      const dur = Number(shot.duration) || 0
      const start = t
      const end = t + Math.max(0, dur)
      t = end
      return { ...shot, timecode_start: Number(start.toFixed(3)), timecode_end: Number(end.toFixed(3)) }
    })
    return { ...seg, shots }
  })
  return { ...tl, segments: nextSegments, total_duration: Number(t.toFixed(3)) }
}

function enforceShotConstraints(shot: AudioTimelineShot, duration: number) {
  const voiceMs = Number(shot.voice_duration_ms) || 0
  const minVoice = voiceMs > 0 ? voiceMs / 1000 : 0
  const min = Math.max(2.0, minVoice)
  return ceilToHalf(Math.max(min, duration))
}

export default function AudioWorkbench({
  projectId,
  includeNarration,
  includeDialogue,
  onExitToStoryboard,
  onReloadProject,
}: {
  projectId: string
  includeNarration: boolean
  includeDialogue: boolean
  onExitToStoryboard: () => void
  onReloadProject: (projectId: string) => Promise<void>
}) {
  const waveformRef = useRef<WaveformHandle>(null)

  const [timeline, setTimeline] = useState<AudioTimeline | null>(null)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [masterAudioUrl, setMasterAudioUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [generatingVoice, setGeneratingVoice] = useState(false)
  const [generatingMaster, setGeneratingMaster] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshTimeline = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getAgentAudioTimeline(projectId)
      const tl = res.audio_timeline
      setTimeline(tl)
      setDuration(Number(tl.total_duration) || 0)
      setMasterAudioUrl(resolveMediaUrl(tl.master_audio_url || ''))

      const first = tl.segments?.[0]?.shots?.[0]?.shot_id
      setSelectedShotId((prev) => prev || first || null)
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refreshTimeline()
  }, [refreshTimeline])

  const flatShots = useMemo(() => {
    if (!timeline) return []
    return timeline.segments.flatMap((seg) => seg.shots.map((s) => ({ ...s, segment_id: seg.segment_id, segment_name: seg.segment_name })))
  }, [timeline])

  const missingVoiceShotIds = useMemo(() => {
    const missing: string[] = []
    for (const s of flatShots) {
      const url = (s.voice_audio_url || '').trim()
      if (!url) missing.push(s.shot_id)
    }
    return missing
  }, [flatShots])

  const violations = useMemo(() => {
    const bad: Array<{ shotId: string; reason: string }> = []
    for (const s of flatShots) {
      const voiceMs = Number(s.voice_duration_ms) || 0
      if (voiceMs > 0) {
        const voiceSec = voiceMs / 1000
        if (Number(s.duration) + 1e-6 < voiceSec) {
          bad.push({ shotId: s.shot_id, reason: `镜头时长 ${s.duration}s < 人声 ${voiceSec.toFixed(2)}s` })
        }
      }
      if (Number(s.duration) < 2.0) {
        bad.push({ shotId: s.shot_id, reason: '镜头时长 < 2s' })
      }
    }
    return bad
  }, [flatShots])

  const handleSelectShot = useCallback((shotId: string) => {
    setSelectedShotId(shotId)
    const s = flatShots.find((x) => x.shot_id === shotId)
    if (s && waveformRef.current) {
      waveformRef.current.seekTo(s.timecode_start || 0)
    }
  }, [flatShots])

  const updateShotDuration = useCallback((shotId: string, newDuration: number) => {
    setTimeline((prev) => {
      if (!prev) return prev
      const next = {
        ...prev,
        segments: prev.segments.map((seg) => ({
          ...seg,
          shots: seg.shots.map((s) => (s.shot_id === shotId ? { ...s, duration: enforceShotConstraints(s, newDuration) } : s)),
        })),
      }
      return rebuildTimecodes(next)
    })
  }, [])

  const handleAlignToVoice = useCallback(() => {
    setTimeline((prev) => {
      if (!prev) return prev
      const next = {
        ...prev,
        segments: prev.segments.map((seg) => ({
          ...seg,
          shots: seg.shots.map((s) => {
            const voiceMs = Number(s.voice_duration_ms) || 0
            if (voiceMs <= 0) return s
            const voiceSec = voiceMs / 1000
            const target = ceilToHalf(voiceSec + 0.4)
            return { ...s, duration: enforceShotConstraints(s, Math.max(Number(s.duration) || 0, target)) }
          }),
        })),
      }
      setNotice('已按人声时长一键对齐（并向上取整到 0.5s）')
      return rebuildTimecodes(next)
    })
  }, [])

  const handleGenerateVoice = useCallback(async (overwrite: boolean) => {
    if (!includeNarration && !includeDialogue) {
      setError('请至少选择一个：旁白 或 对白')
      return
    }
    setGeneratingVoice(true)
    setError(null)
    try {
      await generateAgentAudio(projectId, {
        overwrite,
        includeNarration,
        includeDialogue,
      })
      await onReloadProject(projectId)
      await refreshTimeline()
      setNotice('音频已生成/补齐，可刷新波形预览。')
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setGeneratingVoice(false)
    }
  }, [includeDialogue, includeNarration, onReloadProject, projectId, refreshTimeline])

  const handleRefreshMasterAudio = useCallback(async () => {
    if (!timeline) return
    setGeneratingMaster(true)
    setError(null)
    try {
      const res = await generateAudioTimelineMasterAudio(projectId, buildShotDurationMap(timeline))
      setMasterAudioUrl(resolveMediaUrl(res.master_audio_url))
      setTimeline((prev) => (prev ? { ...prev, master_audio_url: res.master_audio_url } : prev))
      setNotice('已刷新波形预览音轨。')
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setGeneratingMaster(false)
    }
  }, [projectId, timeline])

  const handleConfirmAndSave = useCallback(async () => {
    if (!timeline) return
    if (violations.length > 0) {
      setError(`存在 ${violations.length} 处不满足约束，先修复后再保存。`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: AudioTimeline = { ...timeline, confirmed: true }
      const res = await saveAgentAudioTimeline(projectId, payload, { applyToProject: true, resetVideos: true })
      setTimeline(res.audio_timeline)
      await onReloadProject(projectId)
      setNotice('✅ 已保存并应用到项目（已重置需要重生成的视频引用）。')
      onExitToStoryboard()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }, [onExitToStoryboard, onReloadProject, projectId, timeline, violations.length])

  const handlePlayShot = useCallback((shotId: string) => {
    const shot = flatShots.find((s) => s.shot_id === shotId)
    if (!shot || !waveformRef.current) return
    waveformRef.current.play(shot.timecode_start || 0, shot.timecode_end || undefined)
  }, [flatShots])

  const handleSeek = useCallback((seconds: number) => {
    waveformRef.current?.seekTo(seconds)
  }, [])

  const handlePrevNext = useCallback((dir: -1 | 1) => {
    if (!selectedShotId) return
    const idx = flatShots.findIndex((s) => s.shot_id === selectedShotId)
    if (idx < 0) return
    const next = flatShots[idx + dir]
    if (next) handleSelectShot(next.shot_id)
  }, [flatShots, handleSelectShot, selectedShotId])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    )
  }

  if (!timeline) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 text-red-300">
          <AlertCircle size={18} />
          <span className="text-sm">无法加载 audio_timeline</span>
        </div>
        {error && <p className="mt-2 text-sm text-gray-400 whitespace-pre-wrap">{error}</p>}
        <button onClick={() => void refreshTimeline()} className="mt-4 px-4 py-2 glass-button rounded-xl text-sm">
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gradient">音频编辑工作台</h2>
            <p className="text-xs text-gray-500 mt-1">
              总时长 {formatTime(Number(timeline.total_duration) || 0)} · {flatShots.length} 镜头 · confirmed: {String(Boolean(timeline.confirmed))}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {missingVoiceShotIds.length > 0 && (
              <>
                <button
                  onClick={() => void handleGenerateVoice(false)}
                  disabled={generatingVoice}
                  className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                  title="补齐缺失的人声轨（不覆盖已有）"
                >
                  {generatingVoice ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                  补齐音频({missingVoiceShotIds.length})
                </button>
                <button
                  onClick={() => void handleGenerateVoice(true)}
                  disabled={generatingVoice}
                  className="px-3 py-2 glass-button rounded-xl text-sm disabled:opacity-50"
                  title="强制重生成所有镜头的人声轨"
                >
                  强制重生成
                </button>
              </>
            )}

            <button
              onClick={handleAlignToVoice}
              className="px-3 py-2 glass-button rounded-xl text-sm"
              title="将每个镜头时长抬到 ≥ 人声时长，并向上取整到 0.5s"
            >
              一键对齐人声
            </button>
            <button
              onClick={() => void handleRefreshMasterAudio()}
              disabled={generatingMaster || missingVoiceShotIds.length > 0}
              className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              title={missingVoiceShotIds.length > 0 ? '请先补齐音频后再生成波形预览' : '生成/刷新波形预览音轨'}
            >
              {generatingMaster ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              刷新波形
            </button>
            <button
              onClick={() => void handleConfirmAndSave()}
              disabled={saving}
              className="px-3 py-2 gradient-primary rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              title="保存 audio_timeline，并把 duration 写回项目（会重置需要重生成的视频引用）"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              确认并保存
            </button>
          </div>
        </div>

        {notice && (
          <div className="mt-3 text-xs text-green-300">
            <CheckCircle size={14} className="inline mr-1" />
            {notice}
          </div>
        )}

        {error && (
          <div className="mt-3 text-xs text-red-300 whitespace-pre-wrap">
            <AlertCircle size={14} className="inline mr-1" />
            {error}
          </div>
        )}

        {violations.length > 0 && (
          <div className="mt-3 text-xs text-yellow-300">
            <AlertCircle size={14} className="inline mr-1" />
            发现 {violations.length} 处约束问题（示例：{violations[0].shotId} · {violations[0].reason}）
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div className="glass-card rounded-2xl p-4">
            <WaveformDisplay
              ref={waveformRef}
              audioUrl={masterAudioUrl}
              onTimeUpdate={(t) => setCurrentTime(t)}
              onReady={(d) => setDuration(d)}
              onPlayStateChange={setIsPlaying}
            />

            <PlaybackControls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onPlayPause={() => {
                if (!waveformRef.current) return
                if (waveformRef.current.isPlaying()) waveformRef.current.pause()
                else waveformRef.current.play()
              }}
              onSeek={(t) => handleSeek(t)}
              onPrevShot={() => handlePrevNext(-1)}
              onNextShot={() => handlePrevNext(1)}
              onPlayShot={() => {
                if (selectedShotId) handlePlayShot(selectedShotId)
              }}
              disablePlayback={!masterAudioUrl}
            />
          </div>

          <div className="glass-card rounded-2xl p-4">
            <SegmentTimeline
              segments={timeline.segments}
              selectedShotId={selectedShotId}
              onSelectShot={handleSelectShot}
              onSetDuration={updateShotDuration}
            />
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <ShotListEditor
            segments={timeline.segments}
            selectedShotId={selectedShotId}
            onSelectShot={handleSelectShot}
            onSetDuration={updateShotDuration}
            onPlayShot={handlePlayShot}
          />
        </div>
      </div>
    </div>
  )
}
