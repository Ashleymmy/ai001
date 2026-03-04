import { useState } from 'react'
import { ImageIcon, RefreshCw, Video, Mic, CheckCircle } from 'lucide-react'
import HoverMediaPreview from './HoverMediaPreview'
import type { StudioShot } from '../../store/studioStore'

function ShotCard({
  shot,
  index,
  isSelected,
  onClick,
  onGenerateFrame,
  onGenerateEndFrame,
  onGenerateVideo,
  onGenerateAudio,
  generating,
}: {
  shot: StudioShot
  index: number
  isSelected: boolean
  onClick: () => void
  onGenerateFrame: () => void
  onGenerateEndFrame: () => void
  onGenerateVideo: () => void
  onGenerateAudio: () => void
  generating: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={`group relative rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-purple-500 bg-gray-900/80'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      {/* 缩略图区域 */}
      <div className="aspect-video bg-gray-800 rounded-t-lg overflow-hidden relative">
        {shot.start_image_url ? (
          <img
            src={shot.start_image_url}
            alt={shot.name}
            className="w-full h-full object-contain bg-gray-900/70"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}
        <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
          #{index + 1}
        </div>
        <div className="absolute top-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
          {shot.duration}s
        </div>
        {shot.end_image_url && (
          <div className="absolute bottom-1 left-1 w-12 h-8 rounded border border-white/30 overflow-hidden bg-black/40">
            <img src={shot.end_image_url} alt="end-frame" className="w-full h-full object-contain bg-gray-900/70" />
          </div>
        )}
        {shot.video_url && (
          <div className="absolute bottom-1 right-1 bg-green-500/80 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Video className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* 内容 */}
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-200 truncate">{shot.name || `镜头${index + 1}`}</span>
          <span className="text-xs text-gray-500">{shot.type}</span>
        </div>
        {shot.narration && (
          <p className="text-xs text-gray-400 line-clamp-2 mb-2">{shot.narration}</p>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-wrap">
          {!shot.start_image_url ? (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              帧
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重做帧
            </button>
          )}
          {shot.end_prompt && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateEndFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              {shot.end_image_url ? '重做尾帧' : '尾帧'}
            </button>
          )}
          {shot.start_image_url && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateVideo() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {shot.video_url ? <RefreshCw className="w-3 h-3" /> : <Video className="w-3 h-3" />}
              {shot.video_url ? '重做视频' : '视频'}
            </button>
          )}
          {(shot.narration || shot.dialogue_script) && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateAudio() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {shot.audio_url ? <RefreshCw className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              {shot.audio_url ? '重做音频' : '音频'}
            </button>
          )}
          {shot.status === 'completed' && (
            <CheckCircle className="w-3.5 h-3.5 text-green-400 ml-auto" />
          )}
        </div>
      </div>

      <HoverMediaPreview
        active={hovered}
        shot={shot}
        index={index}
        maxWidthClass="max-w-5xl"
        openDelayMs={800}
        videoDelayMs={800}
      />
    </div>
  )
}

export default ShotCard
