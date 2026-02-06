import { useEffect, useRef, useState } from 'react'
import { Edit3, Maximize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { AgentSegment } from '../../../services/api'


// 时间线面板
export function TimelinePanel({
  segments,
  onJumpToShot
}: {
  segments: AgentSegment[]
  onJumpToShot?: (shotId: string, section?: 'video' | 'audio') => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [videoAudioEnabled, setVideoAudioEnabled] = useState(true)
  const [waitingForVoiceEnd, setWaitingForVoiceEnd] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const voiceRef = useRef<HTMLAudioElement>(null)
  const isAutoAdvancingRef = useRef(false)
  
  const allShots = segments.flatMap(seg => seg.shots)
  const completedVideos = allShots.filter(s => s.video_url)
  const totalDuration = allShots.reduce((acc, shot) => acc + (shot.duration || 5), 0)

  const resolveMediaUrl = (url?: string | null) => {
    const u = (url || '').trim()
    if (!u) return ''
    if (/^(https?:|data:|blob:)/i.test(u)) return u
    if (u.startsWith('/api/')) return `http://localhost:8001${u}`
    return u
  }

  const currentVideo = completedVideos[currentVideoIndex]
  const currentVoiceUrl = voiceEnabled ? resolveMediaUrl((currentVideo as unknown as { voice_audio_url?: string })?.voice_audio_url || '') : ''

  useEffect(() => {
    if (currentVideoIndex >= completedVideos.length && completedVideos.length > 0) {
      setCurrentVideoIndex(Math.max(0, completedVideos.length - 1))
    }
  }, [completedVideos.length, currentVideoIndex])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const shouldPlay = isPlaying || isAutoAdvancingRef.current
    if (!shouldPlay) return

    const tryPlay = async () => {
      try {
        v.currentTime = 0
        await v.play()

        const a = voiceRef.current
        if (a) {
          if (voiceEnabled && currentVoiceUrl) {
            if (a.src !== currentVoiceUrl) a.src = currentVoiceUrl
            a.currentTime = 0
            await a.play().catch(() => {})
          } else {
            a.pause()
          }
        }
      } catch {
        // ignore autoplay/play promise errors
      } finally {
        isAutoAdvancingRef.current = false
      }
    }

    // 等待 src 更新后再播放
    const id = window.setTimeout(() => void tryPlay(), 0)
    return () => window.clearTimeout(id)
  }, [currentVideoIndex, isPlaying, currentVoiceUrl, voiceEnabled])

  useEffect(() => {
    if (isPlaying) return
    if (waitingForVoiceEnd) return
    voiceRef.current?.pause()
  }, [isPlaying, waitingForVoiceEnd])

  // 当前视频播放完毕，切换到下一个
  const handleVideoEnded = () => {
    // 若人声比视频长：先让人声念完，再切到下一个镜头（画面停留在最后一帧）
    const a = voiceRef.current
    if (voiceEnabled && a && isFinite(a.duration) && a.duration > 0) {
      if (a.currentTime < a.duration - 0.12) {
        setWaitingForVoiceEnd(true)
        setIsPlaying(true)
        return
      }
    }
    setWaitingForVoiceEnd(false)
    if (currentVideoIndex < completedVideos.length - 1) {
      isAutoAdvancingRef.current = true
      setIsPlaying(true)
      setCurrentVideoIndex(prev => prev + 1)
    } else {
      // 全部播放完毕
      setIsPlaying(false)
      setCurrentVideoIndex(0)
    }
  }

  // 播放/暂停控制
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
        voiceRef.current?.pause()
      } else {
        isAutoAdvancingRef.current = false
        videoRef.current.play().catch(() => {})
        if (voiceEnabled && currentVoiceUrl) {
          const a = voiceRef.current
          if (a) {
            if (a.src !== currentVoiceUrl) a.src = currentVoiceUrl
            a.play().catch(() => {})
          }
        }
      }
    }
  }

  // 上一个视频
  const handlePrevious = () => {
    if (currentVideoIndex > 0) {
      setWaitingForVoiceEnd(false)
      voiceRef.current?.pause()
      isAutoAdvancingRef.current = isPlaying
      setCurrentVideoIndex(prev => prev - 1)
    }
  }

  // 下一个视频
  const handleNext = () => {
    if (currentVideoIndex < completedVideos.length - 1) {
      setWaitingForVoiceEnd(false)
      voiceRef.current?.pause()
      isAutoAdvancingRef.current = isPlaying
      setCurrentVideoIndex(prev => prev + 1)
    }
  }

  // 更新当前时间
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      // 计算总时间（之前视频的时长 + 当前视频的播放时间）
      const previousDuration = completedVideos
        .slice(0, currentVideoIndex)
        .reduce((acc, shot) => acc + (shot.duration || 5), 0)
      setCurrentTime(previousDuration + videoRef.current.currentTime)

      const a = voiceRef.current
      if (a && voiceEnabled && currentVoiceUrl) {
        const diff = Math.abs(a.currentTime - videoRef.current.currentTime)
        if (diff > 0.25) {
          try {
            a.currentTime = videoRef.current.currentTime
          } catch {
            // ignore seek errors
          }
        }
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 视频预览区 */}
      <div className="flex-1 flex items-center justify-center glass-card rounded-2xl mb-4">
        {completedVideos.length === 0 ? (
          <div className="text-center">
            <img
              src="/yuanyuan/confused.png"
              alt="等待中"
              className="w-24 h-24 mx-auto mb-4 object-contain"
            />
            <h3 className="text-lg font-medium mb-2 text-gradient">等待视频生成</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              {allShots.length > 0
                ? `共 ${allShots.length} 个镜头待生成，请在分镜面板点击「生成视频」`
                : '请先在右侧对话框描述你的项目'}
            </p>
          </div>
        ) : (
          <div className="w-full max-w-3xl">
            <div className="aspect-video glass rounded-2xl flex items-center justify-center mb-4 overflow-hidden relative">
              <video 
                ref={videoRef}
                src={resolveMediaUrl(completedVideos[currentVideoIndex]?.video_url)} 
                className="w-full h-full object-contain"
                onEnded={handleVideoEnded}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  if (isAutoAdvancingRef.current) return
                  if (waitingForVoiceEnd) return
                  setIsPlaying(false)
                }}
                muted={!videoAudioEnabled}
              />
              <audio
                className="hidden"
                ref={voiceRef}
                src={currentVoiceUrl || undefined}
                onEnded={() => {
                  if (!waitingForVoiceEnd) return
                  setWaitingForVoiceEnd(false)
                  if (currentVideoIndex < completedVideos.length - 1) {
                    isAutoAdvancingRef.current = true
                    setIsPlaying(true)
                    setCurrentVideoIndex(prev => prev + 1)
                  } else {
                    setIsPlaying(false)
                    setCurrentVideoIndex(0)
                  }
                }}
              />
              {/* 视频序号指示器 */}
              <div className="absolute top-4 right-4 glass px-3 py-1.5 rounded-lg text-xs font-medium">
                {currentVideoIndex + 1} / {completedVideos.length}
              </div>
              {/* 当前镜头名称 */}
              <div className="absolute bottom-4 left-4 glass px-3 py-1.5 rounded-lg text-xs">
                {completedVideos[currentVideoIndex]?.name}
              </div>
            </div>
            <p className="text-sm text-gray-400 text-center">
              {completedVideos.length}/{allShots.length} 个视频已生成 · 总时长 {Math.round(totalDuration)} 秒
            </p>
          </div>
        )}
      </div>

      {/* 播放控制 */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-center gap-4 mb-4">
          <span className="text-sm text-gray-400 w-16 font-mono">{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrevious}
              disabled={currentVideoIndex === 0}
              className="p-2.5 glass-button rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipBack size={18} />
            </button>
            <button 
              onClick={handlePlayPause} 
              disabled={completedVideos.length === 0}
              className="p-4 gradient-primary rounded-2xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button 
              onClick={handleNext}
              disabled={currentVideoIndex >= completedVideos.length - 1}
              className="p-2.5 glass-button rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipForward size={18} />
            </button>
          </div>
          <span className="text-sm text-gray-400 w-16 text-right font-mono">{formatTime(totalDuration)}</span>
          <button className="p-2.5 glass-button rounded-xl ml-4"><Maximize2 size={18} /></button>
        </div>

        <div className="flex items-center justify-center gap-3 mb-4 text-xs">
          <button
            type="button"
            onClick={() => setVoiceEnabled(v => !v)}
            className={`px-3 py-1.5 rounded-full glass-button transition-apple ${voiceEnabled ? 'text-green-300' : 'text-gray-400'}`}
            title="切换旁白/对白人声轨预览"
          >
            {voiceEnabled ? '人声：开' : '人声：关'}
          </button>
          <button
            type="button"
            onClick={() => setVideoAudioEnabled(v => !v)}
            className={`px-3 py-1.5 rounded-full glass-button transition-apple ${videoAudioEnabled ? 'text-cyan-300' : 'text-gray-400'}`}
            title="切换视频原音轨预览"
          >
            {videoAudioEnabled ? '视频原声：开' : '视频原声：关'}
          </button>
        </div>

        {/* 时间轴 */}
        <div className="relative">
          <div className="flex justify-between text-xs text-gray-500 mb-3 px-1">
            {Array.from({ length: Math.min(6, Math.ceil(totalDuration / 10) + 1) }, (_, i) => (
              <span key={i} className="font-mono">{formatTime(i * 10)}</span>
            ))}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">视频</span>
              <div className="flex-1 h-12 glass rounded-xl relative overflow-hidden flex">
                {allShots.map((shot, index) => {
                  const width = totalDuration > 0 ? (shot.duration / totalDuration) * 100 : 0
                  const hasVideo = !!shot.video_url
                  const isCurrentVideo = completedVideos[currentVideoIndex]?.id === shot.id
                  return (
                    <div
                      key={shot.id}
                      className={`group relative h-full flex items-center justify-center text-xs truncate px-1 border-r border-white/10 last:border-r-0 cursor-pointer transition-all ${
                        hasVideo ? '' : 'opacity-30'
                      } ${isCurrentVideo ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                      style={{ 
                        width: `${width}%`,
                        background: hasVideo 
                          ? `linear-gradient(135deg, hsl(${(index * 40) % 360}, 50%, ${isCurrentVideo ? 40 : 30}%), hsl(${(index * 40 + 30) % 360}, 50%, ${isCurrentVideo ? 30 : 20}%))`
                          : 'rgba(255,255,255,0.05)'
                      }}
                      title={shot.name}
                      onClick={() => {
                        if (hasVideo) {
                          const videoIndex = completedVideos.findIndex(v => v.id === shot.id)
                          if (videoIndex >= 0) {
                            isAutoAdvancingRef.current = isPlaying
                            setCurrentVideoIndex(videoIndex)
                          }
                        }
                      }}
                    >
                      {width > 8 && shot.name.split('_').pop()}
                      {onJumpToShot && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onJumpToShot(shot.id, 'video')
                          }}
                          className="absolute top-1 right-1 p-1 rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-apple"
                          title="跳转到该镜头编辑（视频提示词/画面）"
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">旁白</span>
              <div className="flex-1 h-8 glass rounded-xl relative overflow-hidden flex">
                {allShots.map((shot) => {
                  const width = totalDuration > 0 ? (shot.duration / totalDuration) * 100 : 0
                  const hasVoice = Boolean((shot as { voice_audio_url?: string }).voice_audio_url)
                  return (
                    <div
                      key={`voice_${shot.id}`}
                      className={`group relative h-full border-r border-white/10 last:border-r-0 ${hasVoice ? '' : 'opacity-30'} cursor-pointer`}
                      style={{
                        width: `${width}%`,
                        background: hasVoice
                          ? `linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.18))`
                          : 'rgba(255,255,255,0.05)'
                      }}
                      title={hasVoice ? `${shot.name}（已生成）` : `${shot.name}（未生成）`}
                      onClick={() => {
                        const videoIndex = completedVideos.findIndex(v => v.id === shot.id)
                        if (videoIndex >= 0) {
                          isAutoAdvancingRef.current = isPlaying
                          setCurrentVideoIndex(videoIndex)
                        }
                      }}
                    >
                      {onJumpToShot && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onJumpToShot(shot.id, 'audio')
                          }}
                          className="absolute top-1 right-1 p-1 rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-apple"
                          title="跳转到该镜头编辑（旁白/对白文本）"
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">音乐</span>
              <div className="flex-1 h-8 glass rounded-xl relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg m-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}
