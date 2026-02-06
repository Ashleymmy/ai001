import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import type { AudioTimeline, AudioTimelineShot } from '../../services/api'
import {
  extractAudioFromVideos,
  generateAgentAudio,
  generateAudioTimelineMasterAudio,
  getAgentAudioTimeline,
  getAgentProject,
  saveAgentAudioTimeline,
} from '../../services/api'
import PlaybackControls from './PlaybackControls'
import SegmentTimeline from './SegmentTimeline'
import ShotListEditor from './ShotListEditor'
import MultiTrackTimeline from './MultiTrackTimeline'
import WaveformDisplay, { type WaveformHandle } from './WaveformDisplay'

function resolveMediaUrl(url?: string | null) {
  const u = (url || '').trim()
  if (!u) return ''
  if (/^(data:|blob:)/i.test(u)) return u
  if (/^https?:/i.test(u)) return u
  if (u.startsWith('/api/')) return `http://localhost:8001${u}`
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

function isSpeakableText(text: unknown) {
  if (typeof text !== 'string') return false
  const s = text.replace(/\s+/g, '').trim()
  if (!s) return false
  return /[\u4e00-\u9fffA-Za-z0-9]/.test(s)
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
  const [masterNarrationAudioUrl, setMasterNarrationAudioUrl] = useState<string>('')
  const [masterMixAudioUrl, setMasterMixAudioUrl] = useState<string>('')
  const [previewMode, setPreviewMode] = useState<'narration' | 'mix'>('mix')
  const [loading, setLoading] = useState(true)
  const [generatingVoice, setGeneratingVoice] = useState(false)
  const [selectedShotAudioMode, setSelectedShotAudioMode] = useState<'generate' | 'regenerate' | null>(null)
  const [generatingMaster, setGeneratingMaster] = useState(false)
  const [extractingVideoAudio, setExtractingVideoAudio] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mediaByShotId, setMediaByShotId] = useState<Record<string, { start_image_url?: string; video_url?: string; status?: string }>>({})
  const [workflowMode, setWorkflowMode] = useState<'tts_all' | 'video_dialogue'>('tts_all')
  const [speakableByShotId, setSpeakableByShotId] = useState<Record<string, { narration: boolean; dialogue: boolean }>>({})

  const refreshProjectMedia = useCallback(async () => {
    try {
      const proj = await getAgentProject(projectId)
      const rawMode = String((proj.creative_brief || {})['audioWorkflowResolved'] || '').trim().toLowerCase()
      setWorkflowMode(rawMode === 'video_dialogue' ? 'video_dialogue' : 'tts_all')
      const next: Record<string, { start_image_url?: string; video_url?: string; status?: string }> = {}
      const speakable: Record<string, { narration: boolean; dialogue: boolean }> = {}
      for (const seg of proj.segments || []) {
        for (const shot of seg.shots || []) {
          const sid = shot.id
          next[sid] = {
            start_image_url: (shot.cached_start_image_url || shot.start_image_url || '').trim() || undefined,
            video_url: (shot.video_url || '').trim() || undefined,
            status: (shot.status || '').trim() || undefined,
          }
          speakable[sid] = {
            narration: isSpeakableText(shot.narration),
            dialogue: isSpeakableText(shot.dialogue_script || ''),
          }
        }
      }
      setMediaByShotId(next)
      setSpeakableByShotId(speakable)
    } catch {
      // ignore
    }
  }, [projectId])

  const refreshTimeline = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getAgentAudioTimeline(projectId)
      const tl = res.audio_timeline
      setTimeline(tl)
      setDuration(Number(tl.total_duration) || 0)
      setMasterNarrationAudioUrl(resolveMediaUrl(tl.master_audio_url || ''))
      setMasterMixAudioUrl(resolveMediaUrl(tl.master_mix_audio_url || ''))
      setPreviewMode((prev) => {
        const hasNarr = Boolean((tl.master_audio_url || '').trim())
        const hasMix = Boolean((tl.master_mix_audio_url || '').trim())
        if (prev === 'mix') return hasMix ? 'mix' : hasNarr ? 'narration' : 'mix'
        return hasNarr ? 'narration' : hasMix ? 'mix' : 'narration'
      })

      const first = tl.segments?.[0]?.shots?.[0]?.shot_id
      setSelectedShotId((prev) => prev || first || null)
      void refreshProjectMedia()
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

  useEffect(() => {
    void refreshProjectMedia()
  }, [refreshProjectMedia])

  useEffect(() => {
    const shouldPoll = Object.values(mediaByShotId).some((m) => (m.status || '').includes('video_processing'))
    if (!shouldPoll) return
    const id = window.setInterval(() => void refreshProjectMedia(), 4000)
    return () => window.clearInterval(id)
  }, [mediaByShotId, refreshProjectMedia])

  const flatShots = useMemo(() => {
    if (!timeline) return []
    return timeline.segments.flatMap((seg) => seg.shots.map((s) => ({ ...s, segment_id: seg.segment_id, segment_name: seg.segment_name })))
  }, [timeline])

  const durationLocked = useMemo(() => {
    return Object.values(mediaByShotId).some((m) => {
      if (!m) return false
      const videoUrl = (m.video_url || '').trim()
      if (!videoUrl) return false
      const status = (m.status || '').toLowerCase()
      return !status.includes('processing')
    })
  }, [mediaByShotId])

  const effectiveIncludeDialogue = workflowMode === 'video_dialogue' ? false : includeDialogue

  const missingVoiceShotIds = useMemo(() => {
    const missing: string[] = []
    for (const s of flatShots) {
      const speakable = speakableByShotId[s.shot_id]
      const needNarration = includeNarration && speakable?.narration
      const needDialogue = effectiveIncludeDialogue && speakable?.dialogue
      if (!needNarration && !needDialogue) continue

      const hasNarrationUrl = Boolean((s.narration_audio_url || s.voice_audio_url || '').trim())
      const hasDialogueUrl = Boolean((s.dialogue_audio_url || s.voice_audio_url || '').trim())

      if ((needNarration && !hasNarrationUrl) || (needDialogue && !hasDialogueUrl)) {
        missing.push(s.shot_id)
      }
    }
    return missing
  }, [effectiveIncludeDialogue, flatShots, includeNarration, includeDialogue, speakableByShotId, workflowMode])

  const missingVideoAudioShotIds = useMemo(() => {
    if (workflowMode !== 'video_dialogue') return []
    const missing: string[] = []
    for (const s of flatShots) {
      const m = mediaByShotId[s.shot_id]
      const hasVideo = Boolean((m?.video_url || '').trim())
      if (!hasVideo) continue
      const url = (s.dialogue_audio_url || '').trim()
      if (!url) missing.push(s.shot_id)
    }
    return missing
  }, [flatShots, mediaByShotId, workflowMode])

  const activeMasterAudioUrl = useMemo(() => {
    if (previewMode === 'mix') return masterMixAudioUrl || masterNarrationAudioUrl
    return masterNarrationAudioUrl
  }, [masterMixAudioUrl, masterNarrationAudioUrl, previewMode])

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
    if (durationLocked) {
      setNotice('检测到已有视频，镜头时长已锁定；如需修改请先重置/重生成视频。')
      return
    }
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
  }, [durationLocked])

  const handleAlignToVoice = useCallback(() => {
    if (durationLocked) {
      setNotice('检测到已有视频，镜头时长已锁定；如需对齐请先重置/重生成视频。')
      return
    }
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
  }, [durationLocked])

  const handleGenerateVoice = useCallback(async (overwrite: boolean) => {
    const effIncludeNarration = includeNarration
    const effIncludeDialogue = effectiveIncludeDialogue
    if (!effIncludeNarration && !effIncludeDialogue) {
      setError(workflowMode === 'video_dialogue' ? '音画同出模式下仅生成旁白：请先开启「旁白：开」' : '请至少选择一个：旁白 或 对白')
      return
    }
    setGeneratingVoice(true)
    setError(null)
    try {
      await generateAgentAudio(projectId, {
        overwrite,
        includeNarration: effIncludeNarration,
        includeDialogue: effIncludeDialogue,
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
  }, [effectiveIncludeDialogue, includeNarration, onReloadProject, projectId, refreshTimeline, workflowMode])

  const handleGenerateSelectedShotAudio = useCallback(async (overwrite: boolean) => {
    if (!selectedShotId) return
    const effIncludeNarration = includeNarration
    const effIncludeDialogue = effectiveIncludeDialogue
    if (!effIncludeNarration && !effIncludeDialogue) {
      setError(workflowMode === 'video_dialogue' ? '音画同出模式下仅生成旁白：请先开启「旁白：开」' : '请至少选择一个：旁白 或 对白')
      return
    }

    const speakable = speakableByShotId[selectedShotId]
    const needNarration = effIncludeNarration && Boolean(speakable?.narration)
    const needDialogue = effIncludeDialogue && Boolean(speakable?.dialogue)
    if (!needNarration && !needDialogue) {
      setError('当前选中镜头没有可生成的人声文本（旁白/对白均为空）')
      return
    }

    setSelectedShotAudioMode(overwrite ? 'regenerate' : 'generate')
    setError(null)
    try {
      const result = await generateAgentAudio(projectId, {
        overwrite,
        includeNarration: effIncludeNarration,
        includeDialogue: effIncludeDialogue,
        shotIds: [selectedShotId],
      })
      await onReloadProject(projectId)
      await refreshTimeline()

      if (Number(result.generated) > 0) {
        setNotice(`${overwrite ? '已重生成' : '已生成'}镜头音频：${selectedShotId}`)
      } else if (Number(result.skipped) > 0) {
        setNotice(`镜头音频未生成（已跳过）：${selectedShotId}`)
      } else {
        setNotice(`镜头音频处理完成：${selectedShotId}`)
      }
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setSelectedShotAudioMode(null)
    }
  }, [effectiveIncludeDialogue, includeNarration, onReloadProject, projectId, refreshTimeline, selectedShotId, speakableByShotId, workflowMode])

  const handleExtractAudioFromVideos = useCallback(async () => {
    if (workflowMode !== 'video_dialogue') return
    setExtractingVideoAudio(true)
    setError(null)
    try {
      const res = await extractAudioFromVideos(projectId, { overwrite: false })
      await onReloadProject(projectId)
      await refreshTimeline()
      setNotice(
        `已从视频更新音轨：更新 ${res.updated_shots.length}，无音频流 ${res.skipped_no_audio_stream.length}，失败 ${res.failed.length}`
      )
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '未知错误'
      setError(msg)
    } finally {
      setExtractingVideoAudio(false)
    }
  }, [onReloadProject, projectId, refreshTimeline, workflowMode])

  const handleRefreshMasterAudio = useCallback(async () => {
    if (!timeline) return
    setGeneratingMaster(true)
    setError(null)
    try {
      const res = await generateAudioTimelineMasterAudio(projectId, buildShotDurationMap(timeline), ['narration', 'mix'])
      const narrUrl = resolveMediaUrl(res.master_audio_url || '')
      const mixUrl = resolveMediaUrl(res.master_mix_audio_url || '')
      setMasterNarrationAudioUrl(narrUrl)
      setMasterMixAudioUrl(mixUrl)
      setTimeline((prev) =>
        prev
          ? {
              ...prev,
              master_audio_url: res.master_audio_url,
              master_mix_audio_url: res.master_mix_audio_url,
            }
          : prev
      )
      setPreviewMode((prev) => {
        if (prev === 'mix') return mixUrl ? 'mix' : narrUrl ? 'narration' : prev
        return narrUrl ? 'narration' : mixUrl ? 'mix' : prev
      })
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
      const res = await saveAgentAudioTimeline(projectId, payload, { applyToProject: true, resetVideos: !durationLocked })
      setTimeline(res.audio_timeline)
      await onReloadProject(projectId)
      setNotice(durationLocked ? '✅ 已保存 audio_timeline（不重置已生成视频）。' : '✅ 已保存并应用到项目（已重置需要重生成的视频引用）。')
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
  }, [durationLocked, onExitToStoryboard, onReloadProject, projectId, timeline, violations.length])

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
            {workflowMode === 'video_dialogue' && missingVideoAudioShotIds.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">提示：最终混音预览需要先从视频更新音轨（待抽取 {missingVideoAudioShotIds.length} 镜头）。</p>
            )}
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
                  {workflowMode === 'video_dialogue' ? `补齐旁白(${missingVoiceShotIds.length})` : `补齐音频(${missingVoiceShotIds.length})`}
                </button>
                <button
                  onClick={() => void handleGenerateVoice(true)}
                  disabled={generatingVoice}
                  className="px-3 py-2 glass-button rounded-xl text-sm disabled:opacity-50"
                  title="强制重生成所有镜头的人声轨"
                >
                  {workflowMode === 'video_dialogue' ? '强制重生成旁白' : '强制重生成'}
                </button>
              </>
            )}

            {selectedShotId && (
              <>
                <button
                  onClick={() => void handleGenerateSelectedShotAudio(false)}
                  disabled={selectedShotAudioMode !== null || generatingVoice}
                  className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                  title="仅生成当前选中镜头的人声轨（不覆盖已有）"
                >
                  {selectedShotAudioMode === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  生成本镜头
                </button>
                <button
                  onClick={() => void handleGenerateSelectedShotAudio(true)}
                  disabled={selectedShotAudioMode !== null || generatingVoice}
                  className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                  title="仅重生成当前选中镜头的人声轨（覆盖已有）"
                >
                  {selectedShotAudioMode === 'regenerate' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  重生成本镜头
                </button>
              </>
            )}

            <button
              onClick={handleAlignToVoice}
              disabled={durationLocked}
              className="px-3 py-2 glass-button rounded-xl text-sm"
              title={durationLocked ? '视频已生成，镜头时长已锁定' : '将每个镜头时长抬到 ≥ 人声时长，并向上取整到 0.5s'}
            >
              一键对齐人声
            </button>

            {workflowMode === 'video_dialogue' && (
              <button
                onClick={() => void handleExtractAudioFromVideos()}
                disabled={extractingVideoAudio}
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                title="从已生成视频中抽取音轨（对白/音乐），写入 dialogue_audio_url"
              >
                {extractingVideoAudio ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                从视频更新音轨{missingVideoAudioShotIds.length > 0 ? `(${missingVideoAudioShotIds.length})` : ''}
              </button>
            )}

            <button
              onClick={() => void handleRefreshMasterAudio()}
              disabled={generatingMaster}
              className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              title="生成/刷新波形预览音轨（缺失片段将自动补静默）"
            >
              {generatingMaster ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              刷新波形
            </button>
            <button
              onClick={() => void handleConfirmAndSave()}
              disabled={saving}
              className="px-3 py-2 gradient-primary rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              title={durationLocked ? '保存 audio_timeline（视频已生成：不会重置视频引用）' : '保存 audio_timeline，并把 duration 写回项目（会重置需要重生成的视频引用）'}
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
            <MultiTrackTimeline
              shots={flatShots}
              totalDuration={duration}
              currentTime={currentTime}
              selectedShotId={selectedShotId}
              mediaByShotId={mediaByShotId}
              workflowMode={workflowMode}
              speakableByShotId={speakableByShotId}
              onSelectShot={handleSelectShot}
              onSeek={handleSeek}
              resolveMediaUrl={resolveMediaUrl}
            />

            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-gray-500">试听：</span>
                <button
                  type="button"
                  onClick={() => setPreviewMode('narration')}
                  className={`px-2 py-1 rounded-full glass-button transition-apple ${
                    previewMode === 'narration' ? 'text-green-300' : 'text-gray-400'
                  }`}
                  title="旁白 master（narration-only）"
                >
                  旁白
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('mix')}
                  className={`px-2 py-1 rounded-full glass-button transition-apple ${
                    previewMode === 'mix' ? 'text-cyan-200' : 'text-gray-400'
                  }`}
                  title="最终 master（video_audio + narration 混音）"
                >
                  最终混音
                </button>
              </div>
              <WaveformDisplay
                ref={waveformRef}
                audioUrl={activeMasterAudioUrl}
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
                disablePlayback={!activeMasterAudioUrl}
              />
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4">
            <SegmentTimeline
              segments={timeline.segments}
              selectedShotId={selectedShotId}
              onSelectShot={handleSelectShot}
              onSetDuration={updateShotDuration}
              durationLocked={durationLocked}
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
            durationLocked={durationLocked}
          />
        </div>
      </div>
    </div>
  )
}
