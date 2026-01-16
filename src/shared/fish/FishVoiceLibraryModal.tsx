import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import {
  fishCreateModel,
  fishDeleteModel,
  fishListModels,
  type FishModel,
} from '../../services/api'

type Mode = 'manage' | 'pick'

export function FishVoiceLibraryModal({
  isOpen,
  onClose,
  mode = 'manage',
  onPick,
}: {
  isOpen: boolean
  onClose: () => void
  mode?: Mode
  onPick?: (model: FishModel) => void
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<FishModel[]>([])
  const [query, setQuery] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createVisibility, setCreateVisibility] = useState<'private' | 'unlist' | 'public'>('private')
  const [createTrainMode, setCreateTrainMode] = useState<'fast'>('fast')
  const [createTags, setCreateTags] = useState('')
  const [createVoices, setCreateVoices] = useState<File[]>([])
  const [createCover, setCreateCover] = useState<File | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((m) => {
      const title = String(m.title || '').toLowerCase()
      const desc = String(m.description || '').toLowerCase()
      const id = String(m.id || '').toLowerCase()
      return title.includes(q) || desc.includes(q) || id.includes(q)
    })
  }, [items, query])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fishListModels({ page_size: 50, page_number: 1, self_only: true, model_type: 'tts', sort_by: 'created_at' })
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '加载失败'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    load()
  }, [isOpen, load])

  if (!isOpen) return null

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  const resetCreate = () => {
    setCreateTitle('')
    setCreateDescription('')
    setCreateVisibility('private')
    setCreateTrainMode('fast')
    setCreateTags('')
    setCreateVoices([])
    setCreateCover(null)
  }

  const handleCreate = async () => {
    if (!createTitle.trim() || createVoices.length === 0) return

    setIsLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('title', createTitle.trim())
      if (createDescription.trim()) fd.set('description', createDescription.trim())
      fd.set('visibility', createVisibility)
      fd.set('train_mode', createTrainMode)
      fd.set('enhance_audio_quality', 'true')
      if (createTags.trim()) fd.set('tags', createTags.trim())
      if (createCover) fd.append('cover_image', createCover)
      for (const f of createVoices) fd.append('voices', f)

      await fishCreateModel(fd)
      setShowCreate(false)
      resetCreate()
      await load()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '创建失败'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (modelId: string) => {
    if (!confirm('确定要删除这个音色模型吗？')) return
    setIsLoading(true)
    setError(null)
    try {
      await fishDeleteModel(modelId)
      await load()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as Error)?.message ||
        '删除失败'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fadeIn">
      <div className="glass-card p-6 w-full max-w-3xl mx-4 animate-scaleIn">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">
              {mode === 'pick' ? '选择角色音色（Fish）' : '角色音色库（Fish）'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              复制/选择的是 Fish 的 voice model id（reference_id），用于旁白/对白与角色一致音色
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题 / 描述 / ID"
            className="flex-1 glass-input p-2 text-sm"
          />
          <button
            onClick={load}
            disabled={isLoading}
            className="px-3 py-2 glass-button rounded-xl text-sm disabled:opacity-50"
            title="刷新"
          >
            <span className="flex items-center gap-2">
              <RefreshCcw size={16} />
              刷新
            </span>
          </button>
          {mode === 'manage' && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="px-3 py-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Plus size={16} />
                新建
              </span>
            </button>
          )}
        </div>

        {showCreate && mode === 'manage' && (
          <div className="glass-dark p-4 rounded-2xl mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">标题</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="例如：主角A（温柔女声）"
                  className="w-full glass-input p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">可见性</label>
                <select
                  value={createVisibility}
                  onChange={(e) => setCreateVisibility(e.target.value as 'private' | 'unlist' | 'public')}
                  className="w-full glass-input p-2 text-sm bg-gray-900/80"
                >
                  <option value="private" className="bg-gray-900 text-white">private</option>
                  <option value="unlist" className="bg-gray-900 text-white">unlist</option>
                  <option value="public" className="bg-gray-900 text-white">public</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">描述（可选）</label>
              <input
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="可填角色设定、口音、情绪等"
                className="w-full glass-input p-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">标签（可选，逗号分隔）</label>
                <input
                  value={createTags}
                  onChange={(e) => setCreateTags(e.target.value)}
                  placeholder="narrator, female, warm"
                  className="w-full glass-input p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Train Mode</label>
                <select
                  value={createTrainMode}
                  onChange={(e) => setCreateTrainMode(e.target.value as 'fast')}
                  className="w-full glass-input p-2 text-sm bg-gray-900/80"
                >
                  <option value="fast" className="bg-gray-900 text-white">fast</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">声音样本（必填，多文件）</label>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={(e) => setCreateVoices(Array.from(e.target.files || []))}
                  className="w-full text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  训练时长/数量要求以 Fish 官方为准
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">封面（可选）</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setCreateCover((e.target.files || [])[0] || null)}
                  className="w-full text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreate(false)
                  resetCreate()
                }}
                className="px-4 py-2 glass-button rounded-xl text-sm text-gray-300"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={isLoading || !createTitle.trim() || createVoices.length === 0}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl text-sm font-medium disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-300 glass-dark rounded-xl p-3 mb-3">
            {error}
          </div>
        )}

        <div className="max-h-[50vh] overflow-auto space-y-2 pr-1">
          {filtered.map((m) => (
            <div key={m.id} className="glass-dark rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{String(m.title || '未命名')}</div>
                  <div className="text-xs text-gray-500 break-all mt-1">{m.id}</div>
                  {m.description && (
                    <div className="text-xs text-gray-400 mt-1 line-clamp-2">{String(m.description)}</div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(m.id)}
                    className="px-3 py-2 glass-button rounded-xl text-sm"
                    title="复制 ID"
                  >
                    <span className="flex items-center gap-2">
                      <Copy size={14} />
                      复制
                    </span>
                  </button>
                  {mode === 'pick' && onPick && (
                    <button
                      onClick={() => onPick(m)}
                      className="px-3 py-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl text-sm font-medium"
                    >
                      选择
                    </button>
                  )}
                  {mode === 'manage' && (
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="px-3 py-2 glass-button rounded-xl text-sm text-red-300"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-10">
              {isLoading ? '加载中...' : '暂无音色模型'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

