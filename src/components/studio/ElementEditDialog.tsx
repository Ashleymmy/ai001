/**
 * 功能模块：Studio 组件模块，元素编辑对话框（ElementEditDialog）
 */

import { useState } from 'react'
import type { StudioElement } from '../../store/studioStore'
import DocumentUploadButton from './DocumentUploadButton'

export const MULTI_AGE_SIGNAL_KEYWORDS = [
  '幼年', '童年', '少年', '青年', '中年', '老年', '晚年',
  '前期', '后期', '早期',
  '中期', '初期', '晚期', '末期',
  '年轻时', '年老时',
  '十年后', '多年后', '若干年后',
  '战前', '战后', '回忆', '现实',
  '白天', '夜晚', '雨夜', '雪夜',
]

export function hasMultiAgeSignals(text: string): boolean {
  const source = (text || '').trim()
  if (!source) return false
  if (source.includes('前期') && source.includes('后期')) return true
  const hits = MULTI_AGE_SIGNAL_KEYWORDS.filter((keyword) => source.includes(keyword))
  return new Set(hits).size >= 2
}

export default function ElementEditDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial: StudioElement | null
  onClose: () => void
  onSubmit: (payload: { name: string; type: string; description?: string; voice_profile?: string; is_favorite?: number }) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [type, setType] = useState(initial?.type || 'character')
  const [description, setDescription] = useState(initial?.description || '')
  const [voiceProfile, setVoiceProfile] = useState(initial?.voice_profile || '')
  const [favorite, setFavorite] = useState(initial?.is_favorite === 1)

  const submit = () => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      type,
      description: description.trim(),
      voice_profile: voiceProfile.trim(),
      is_favorite: favorite ? 1 : 0,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-xl p-6">
        <h3 className="text-base font-semibold text-gray-100 mb-4">{initial ? '编辑元素' : '新增元素'}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="character">角色</option>
              <option value="scene">场景</option>
              <option value="object">道具</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">描述</label>
              <DocumentUploadButton
                onTextExtracted={(text) => setDescription(text)}
                label="上传描述"
              />
            </div>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
            />
            {type === 'character' && hasMultiAgeSignals(description) && (
              <p className="text-[11px] text-amber-300 mt-1">
                检测到可能混入多个版本（如前期/后期、战前/战后），建议拆分为单独条目。
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">音色（角色可填）</label>
            <input
              value={voiceProfile}
              onChange={(e) => setVoiceProfile(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              className="rounded"
            />
            收藏
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white">取消</button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
