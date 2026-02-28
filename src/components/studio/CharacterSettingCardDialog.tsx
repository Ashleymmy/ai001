/**
 * 角色设定卡对话框
 * 提供完整的角色设定查看和编辑功能，包括参考图上传、描述文档导入
 */

import { useState, useMemo } from 'react'
import {
  X, Search, Plus, Star, ImageIcon, Loader2, Upload, Trash2, Users,
} from 'lucide-react'
import type {
  StudioSeries,
  StudioElement,
} from '../../store/studioStore'
import type { StudioElementRenderMode, StudioElementReferenceMode } from '../../services/api'
import { uploadFile } from '../../services/api'
import DocumentUploadButton from './DocumentUploadButton'

interface CharacterSettingCardDialogProps {
  series: StudioSeries
  elements: StudioElement[]
  onUpdateElement: (elementId: string, updates: Record<string, unknown>) => void | Promise<void>
  onAddElement: (element: { name: string; type: string; description?: string; voice_profile?: string }) => void | Promise<void>
  onDeleteElement: (elementId: string) => void | Promise<void>
  onGenerateElementImage: (
    elementId: string,
    options?: {
      useReference?: boolean
      referenceMode?: StudioElementReferenceMode
      width?: number
      height?: number
      renderMode?: StudioElementRenderMode
      maxImages?: number
      steps?: number
      seed?: number
    },
  ) => void | Promise<void>
  generating: boolean
  onClose: () => void
}

export default function CharacterSettingCardDialog({
  series,
  elements,
  onUpdateElement,
  onAddElement,
  onDeleteElement,
  onGenerateElementImage,
  generating,
  onClose,
}: CharacterSettingCardDialogProps) {
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)

  // 编辑态
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editVoice, setEditVoice] = useState('')

  const characters = useMemo(
    () => elements.filter((el) => el.type === 'character'),
    [elements],
  )

  const norm = keyword.trim().toLowerCase()
  const filtered = characters.filter(
    (c) => !norm || `${c.name} ${c.description}`.toLowerCase().includes(norm),
  )

  const selected = characters.find((c) => c.id === selectedId) || null

  const selectCharacter = (el: StudioElement) => {
    setSelectedId(el.id)
    setEditName(el.name)
    setEditDesc(el.description || '')
    setEditVoice(el.voice_profile || '')
    setIsCreating(false)
  }

  const startCreate = () => {
    setSelectedId(null)
    setIsCreating(true)
    setEditName('')
    setEditDesc('')
    setEditVoice('')
  }

  const handleSave = async () => {
    if (!editName.trim()) return
    if (isCreating) {
      await onAddElement({
        name: editName.trim(),
        type: 'character',
        description: editDesc.trim(),
        voice_profile: editVoice.trim(),
      })
      setIsCreating(false)
    } else if (selected) {
      await onUpdateElement(selected.id, {
        name: editName.trim(),
        description: editDesc.trim(),
        voice_profile: editVoice.trim(),
      })
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!confirm(`确定删除角色「${selected.name}」吗？`)) return
    await onDeleteElement(selected.id)
    setSelectedId(null)
  }

  const handleUploadRefImage = async (file: File) => {
    if (!selected) return
    setUploadingImage(true)
    try {
      const result = await uploadFile(file)
      if (result.success && result.file.url) {
        await onUpdateElement(selected.id, { image_url: result.file.url })
      }
    } catch (err) {
      console.error('上传参考图失败:', err)
    } finally {
      setUploadingImage(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (!selected) return
    await onUpdateElement(selected.id, {
      is_favorite: selected.is_favorite === 1 ? 0 : 1,
    })
  }

  const showDetail = selected || isCreating

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">角色设定卡</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {series.name} · 角色 {characters.length}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Character list */}
          <div className="w-1/3 border-r border-gray-800 flex flex-col">
            <div className="p-3 border-b border-gray-800 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索角色..."
                  className="w-full bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>
              <button
                onClick={startCreate}
                className="w-full text-xs px-2 py-1.5 rounded bg-purple-700/60 hover:bg-purple-600/60 text-purple-100 inline-flex items-center justify-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                新增角色
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filtered.map((el) => (
                <button
                  key={el.id}
                  onClick={() => selectCharacter(el)}
                  className={`w-full text-left p-2 rounded-lg flex items-center gap-2 transition-colors ${
                    selectedId === el.id
                      ? 'bg-purple-700/30 border border-purple-600/50'
                      : 'hover:bg-gray-800 border border-transparent'
                  }`}
                >
                  {el.image_url ? (
                    <img src={el.image_url} alt={el.name} className="w-8 h-8 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center shrink-0">
                      <ImageIcon className="w-3.5 h-3.5 text-gray-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-gray-200 truncate">{el.name}</p>
                    <p className="text-[10px] text-gray-500 truncate">{el.description || '暂无描述'}</p>
                  </div>
                  {el.is_favorite === 1 && <Star className="w-3 h-3 text-yellow-300 shrink-0 ml-auto" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">
                  {keyword ? '无匹配角色' : '暂无角色'}
                </p>
              )}
            </div>
          </div>

          {/* Right: Character detail card */}
          <div className="w-2/3 overflow-y-auto p-4">
            {showDetail ? (
              <div className="space-y-4">
                {/* Reference image */}
                <div className="flex gap-4">
                  <div className="w-28 h-28 rounded-lg border border-gray-700 bg-gray-800 shrink-0 overflow-hidden relative">
                    {selected?.image_url ? (
                      <img src={selected.image_url} alt={selected.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <ImageIcon className="w-8 h-8" />
                      </div>
                    )}
                    {selected && (
                      <label
                        className="absolute bottom-1 right-1 p-1.5 rounded bg-black/60 hover:bg-black/80 text-gray-300 hover:text-white cursor-pointer transition-colors"
                        title="上传参考图"
                      >
                        {uploadingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleUploadRefImage(file)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">角色名称 *</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="角色名"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">音色配置</label>
                      <input
                        value={editVoice}
                        onChange={(e) => setEditVoice(e.target.value)}
                        placeholder="例如：温柔女声 / 低沉磁性男声"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-gray-500">角色描述</label>
                    <DocumentUploadButton
                      onTextExtracted={(text) => setEditDesc((prev) => prev ? prev + '\n\n' + text : text)}
                      label="上传设定文档"
                    />
                  </div>
                  <textarea
                    rows={8}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="角色外观、性格、背景故事等设定信息..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                  />
                </div>

                {/* Meta info (read-only) */}
                {selected && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-2.5">
                      <p className="text-[10px] text-gray-500 mb-1">出场集数</p>
                      <p className="text-xs text-gray-300">
                        {selected.appears_in_episodes?.length
                          ? `${selected.appears_in_episodes.length} 集`
                          : '暂无出场'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-2.5">
                      <p className="text-[10px] text-gray-500 mb-1">图像版本</p>
                      <div className="flex items-center gap-1">
                        {selected.image_history && selected.image_history.length > 0 ? (
                          <div className="flex -space-x-1">
                            {selected.image_history.slice(0, 5).map((url, i) => (
                              <img key={i} src={url} alt="" className="w-5 h-5 rounded border border-gray-700 object-cover" />
                            ))}
                            {selected.image_history.length > 5 && (
                              <span className="text-[10px] text-gray-500 ml-1">+{selected.image_history.length - 5}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">无历史</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                  <button
                    onClick={handleSave}
                    disabled={!editName.trim()}
                    className="px-3 py-1.5 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors"
                  >
                    {isCreating ? '创建角色' : '保存修改'}
                  </button>
                  {selected && (
                    <>
                      <button
                        onClick={() => onGenerateElementImage(selected.id, { useReference: true, referenceMode: 'light' })}
                        disabled={generating}
                        className="px-3 py-1.5 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                      >
                        {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        {selected.image_url ? '重做参考图' : '生成参考图'}
                      </button>
                      <button
                        onClick={handleToggleFavorite}
                        className={`px-3 py-1.5 rounded text-xs inline-flex items-center gap-1 transition-colors ${
                          selected.is_favorite === 1
                            ? 'bg-yellow-700/50 text-yellow-200'
                            : 'bg-gray-800 hover:bg-gray-700 text-gray-400'
                        }`}
                      >
                        <Star className="w-3 h-3" />
                        {selected.is_favorite === 1 ? '已收藏' : '收藏'}
                      </button>
                      <button
                        onClick={handleDelete}
                        className="px-3 py-1.5 rounded text-xs bg-gray-800 hover:bg-gray-700 text-red-400 inline-flex items-center gap-1 transition-colors ml-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Users className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                  <p className="text-sm">选择左侧角色查看设定卡</p>
                  <p className="text-xs text-gray-600 mt-1">或点击"新增角色"创建</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
