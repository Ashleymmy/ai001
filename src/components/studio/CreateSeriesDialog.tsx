import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { WorkbenchMode } from '../../features/studio/types'
import DocumentUploadButton from './DocumentUploadButton'

function CreateSeriesDialog({
  mode = 'longform',
  onClose,
  onSubmit,
  creating,
}: {
  mode?: WorkbenchMode
  onClose: () => void
  onSubmit: (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    series_bible?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => void | Promise<void>
  creating: boolean
}) {
  const isShortVideo = mode === 'short_video'
  const isDigitalHuman = mode === 'digital_human'
  const title = isShortVideo ? '创建短视频项目' : isDigitalHuman ? '创建数字人短剧项目' : '创建新系列'
  const scriptPlaceholder = isShortVideo
    ? '粘贴短视频脚本（建议 15-60 秒内容）...'
    : isDigitalHuman
      ? '粘贴数字人短剧脚本（对白/口播可更详细）...'
      : '粘贴完整的故事脚本...'
  const [name, setName] = useState('')
  const [script, setScript] = useState('')
  const [description, setDescription] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [seriesBible, setSeriesBible] = useState('')
  const [targetCount, setTargetCount] = useState(isShortVideo || isDigitalHuman ? 1 : 0)
  const [duration, setDuration] = useState(isShortVideo ? 30 : isDigitalHuman ? 45 : 90)

  const handleSubmit = () => {
    if (!name.trim() || !script.trim()) return
    onSubmit({
      name: name.trim(),
      script: script.trim(),
      description: description.trim() || undefined,
      visual_style: visualStyle.trim() || undefined,
      series_bible: seriesBible.trim() || undefined,
      target_episode_count: targetCount || undefined,
      episode_duration_seconds: duration || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">{title}</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">系列名称 *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
              placeholder="例如：竹取物语"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-400">完整脚本 *</label>
              <DocumentUploadButton
                onTextExtracted={(text) => setScript(text)}
                label="上传脚本"
              />
            </div>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={isShortVideo ? 7 : 10}
              placeholder={scriptPlaceholder}
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              {script.length} 字
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-400">世界观 / 人物设定</label>
              <DocumentUploadButton
                onTextExtracted={(text) => setSeriesBible((prev) => prev ? prev + '\n\n' + text : text)}
                label="上传设定文档"
              />
            </div>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={4}
              placeholder="可选，粘贴或上传世界观设定、人物设定卡等文档..."
              value={seriesBible}
              onChange={(e) => setSeriesBible(e.target.value)}
            />
            {seriesBible && (
              <p className="text-xs text-gray-500 mt-1">
                {seriesBible.length} 字
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">简要描述</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                placeholder="可选"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400">视觉风格</label>
                <DocumentUploadButton
                  onTextExtracted={(text) => setVisualStyle(text)}
                  label="上传画风"
                />
              </div>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                placeholder="例如：吉卜力2D / 电影级写实"
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">期望集数（0=自动）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                value={targetCount}
                onChange={(e) => setTargetCount(parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">每集时长（秒）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || (isShortVideo ? 30 : 90))}
                min={isShortVideo ? 10 : 30}
                max={isShortVideo ? 90 : 300}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !script.trim() || creating}
            className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? '创建中（LLM 分幕+元素提取）...' : '创建系列'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateSeriesDialog
