import { useEffect, useState } from 'react'
import {
  AlertCircle, Check, CheckCircle, ChevronDown, ChevronRight, Download, Edit3, Film, Image as ImageIcon, Loader2, Maximize2, Pause, Play, Plus, RotateCcw, Star, Trash2, Upload, Volume2, Wand2, X
} from 'lucide-react'
import { uploadFile, type AgentElement, type AgentSegment, type AgentShot } from '../../../services/api'
import { FishVoiceLibraryModal } from '../../../shared/fish/FishVoiceLibraryModal'
import { useSettingsStore } from '../../../store/settingsStore'
import type { AudioAsset } from '../types'

function isProbablyExpiredSignedUrl(url?: string | null) {
  const raw = (url || '').trim()
  if (!raw || !/^https?:/i.test(raw)) return false
  try {
    const parsed = new URL(raw)
    const qs = parsed.searchParams

    const tosDate = qs.get('X-Tos-Date')
    const tosExpires = qs.get('X-Tos-Expires')
    if (tosDate && tosExpires) {
      const expiresSeconds = Number.parseInt(tosExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(tosDate.slice(0, 4), 10)
      const month = Number.parseInt(tosDate.slice(4, 6), 10)
      const day = Number.parseInt(tosDate.slice(6, 8), 10)
      const hour = Number.parseInt(tosDate.slice(9, 11), 10)
      const minute = Number.parseInt(tosDate.slice(11, 13), 10)
      const second = Number.parseInt(tosDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }

    const amzDate = qs.get('X-Amz-Date')
    const amzExpires = qs.get('X-Amz-Expires')
    if (amzDate && amzExpires) {
      const expiresSeconds = Number.parseInt(amzExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(amzDate.slice(0, 4), 10)
      const month = Number.parseInt(amzDate.slice(4, 6), 10)
      const day = Number.parseInt(amzDate.slice(6, 8), 10)
      const hour = Number.parseInt(amzDate.slice(9, 11), 10)
      const minute = Number.parseInt(amzDate.slice(11, 13), 10)
      const second = Number.parseInt(amzDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }
  } catch {
    return false
  }
  return false
}


// 任务卡片组件
export function TaskCard({ 
  title, 
  icon, 
  expanded, 
  onToggle, 
  badge, 
  children 
}: { 
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <button 
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-apple"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{icon}</span>
          <span className="text-sm font-medium">{title}</span>
          {badge && (
            <span className="text-xs text-gray-500 glass px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

// 音频资产项组件
export function AudioAssetItem({ asset }: { asset: AudioAsset }) {
  const [isPlaying, setIsPlaying] = useState(false)
  
  return (
    <div className="glass p-2 rounded-lg flex items-center gap-2">
      <button 
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-8 h-8 rounded-lg glass-button flex items-center justify-center flex-shrink-0"
      >
        {isPlaying ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{asset.name}</p>
        <div className="flex items-center gap-2 mt-1">
          {/* 简化的波形显示 */}
          <div className="flex-1 h-4 flex items-center gap-px">
            {Array.from({ length: 20 }).map((_, i) => (
              <div 
                key={i} 
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
          {asset.duration && (
            <span className="text-[10px] text-gray-500 flex-shrink-0">{asset.duration}</span>
          )}
        </div>
      </div>
      <button className="p-1.5 glass-button rounded-lg">
        <Volume2 size={12} />
      </button>
    </div>
  )
}

// 关键元素面板
export function ElementsPanel({ 
  elements, expandedElements, toggleElement, editingElement, setEditingElement,
  generatingElement, onGenerateImage, onFavoriteImage, onPreviewImage, onAddElement, onDeleteElement, onUpdateElement,
  onPersistElement,
  onGenerateAll, isGenerating,
  onAddElementFromImage,
  onOpenImportElements
}: { 
  elements: Record<string, AgentElement>
  expandedElements: Set<string>
  toggleElement: (id: string) => void
  editingElement: string | null
  setEditingElement: (id: string | null) => void
  generatingElement: string | null
  onGenerateImage: (id: string) => void
  onFavoriteImage: (elementId: string, imageId: string) => void
  onPreviewImage: (url: string, title: string) => void
  onAddElement: () => void
  onAddElementFromImage?: (payload: { url: string; name?: string }) => Promise<void> | void
  onOpenImportElements?: () => void
  onDeleteElement: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<AgentElement>) => void
  onPersistElement?: (id: string, updates: Partial<AgentElement>) => Promise<void>
  onGenerateAll: () => void
  isGenerating: boolean
}) {
  const elementList = Object.values(elements)
  const completedCount = elementList.filter(e => e.cached_image_url || (e.image_url && !isProbablyExpiredSignedUrl(e.image_url))).length
  const { settings } = useSettingsStore()
  const isFishTTS = (settings.tts.provider || '').startsWith('fish')
  const [voicePickerFor, setVoicePickerFor] = useState<string | null>(null)
  const [uploadingRefFor, setUploadingRefFor] = useState<string | null>(null)
  const [uploadingNewElement, setUploadingNewElement] = useState(false)

  const resolveMediaUrl = (url?: string | null) => {
	    const u = (url || '').trim()
	    if (!u) return ''
	    if (/^(https?:|data:|blob:)/i.test(u)) return isProbablyExpiredSignedUrl(u) ? '' : u
	    if (u.startsWith('/api/')) return `http://localhost:8001${u}`
	    return u
	  }
  
  return (
    <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gradient">关键元素</h2>
            <p className="text-xs text-gray-500 mt-1">{completedCount}/{elementList.length} 已生成图片</p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenImportElements && (
              <button
                onClick={onOpenImportElements}
                disabled={isGenerating}
                className="px-4 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                title="从上一集/历史项目导入人物/场景/道具元素"
              >
                <Download size={16} />
                导入元素
              </button>
            )}
            {elementList.length > 0 && (
              <button
                onClick={onGenerateAll}
                disabled={isGenerating || completedCount === elementList.length}
                className="px-4 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {isGenerating ? '生成中...' : '批量生成'}
              </button>
            )}
          </div>
        </div>
      
      {elementList.length === 0 ? (
        <div className="text-center py-12 glass-card rounded-2xl">
          <img
            src="/yuanyuan/confused.png"
            alt="等待中"
            className="w-20 h-20 mx-auto mb-4 object-contain"
          />
          <p className="text-gray-400 mb-4">还没有创建任何元素</p>
          <p className="text-sm text-gray-500 mb-6">在右侧对话框描述你的项目，AI 会自动规划角色</p>
          <button onClick={onAddElement} className="px-4 py-2 glass-button rounded-xl text-sm">
            <Plus size={16} className="inline mr-2" />手动添加
          </button>
        </div>
      ) : (
        <>
          {elementList.map((element) => (
            <div key={element.id} className="glass-card overflow-hidden">
              <button onClick={() => toggleElement(element.id)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple">
                {expandedElements.has(element.id) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <span className="font-medium text-sm flex-1 text-left">{element.name}</span>
                {(element.cached_image_url || element.image_url) ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <AlertCircle size={16} className="text-yellow-400" />
                )}
                <span className="text-xs text-gray-500 px-2 py-0.5 glass rounded-full">{element.type}</span>
              </button>
              
              {expandedElements.has(element.id) && (
                <div className="px-4 pb-4">
                  {editingElement === element.id ? (
                    <div className="space-y-3">
                      <input type="text" value={element.name} onChange={(e) => onUpdateElement(element.id, { name: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" placeholder="元素名称" />
                      <select value={element.type} onChange={(e) => onUpdateElement(element.id, { type: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none bg-transparent">
                        <option value="character">角色</option>
                        <option value="object">物品</option>
                        <option value="scene">场景</option>
                      </select>
                      <textarea value={element.description} onChange={(e) => onUpdateElement(element.id, { description: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none resize-none" rows={3} placeholder="详细描述..." />
                      {element.type === 'character' && (
                        <div className="glass-dark p-3 rounded-lg">
                          <p className="text-xs text-gray-400 mb-1">角色音色设定（可选，推荐填 voice_type）</p>
                          <textarea
                            value={element.voice_profile || ''}
                            onChange={(e) => onUpdateElement(element.id, { voice_profile: e.target.value })}
                            className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none resize-none"
                            rows={2}
                            placeholder={
                              isFishTTS
                                ? '推荐：填写 Fish 的 voice model id（reference_id）。也可填中文描述作为备注。'
                                : '推荐：直接填写火山 TTS 的 voice_type（如 zh_female_cancan_mars_bigtts）。也可填中文描述作为备注。'
                            }
                          />
                          <p className="text-[10px] text-gray-500 mt-1">
                            生成“旁白/对白音频”时会优先读取此字段；全片同角色保持一致。
                          </p>
                          {isFishTTS && (
                            <div className="flex justify-end mt-2">
                              <button
                                type="button"
                                onClick={() => setVoicePickerFor(element.id)}
                                className="px-3 py-1.5 glass-button rounded-lg text-xs text-gray-200 hover:text-white"
                              >
                                从音色库选择
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setEditingElement(null)} className="flex-1 py-2 glass-button rounded-lg text-sm flex items-center justify-center gap-1"><Check size={14} />完成</button>
                        <button onClick={() => onDeleteElement(element.id)} className="py-2 px-3 glass-button rounded-lg text-sm text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-400 mb-3">{element.description}</p>
                      {element.type === 'character' && element.voice_profile && (
                        <div className="glass-dark p-3 rounded-lg mb-3">
                          <p className="text-xs text-gray-400 mb-1">音色</p>
                          <p className="text-sm text-gray-300 whitespace-pre-wrap">{element.voice_profile}</p>
                        </div>
                      )}

                      {/* 参考图（用于角色/场景/道具一致性） */}
                      <div className="glass-dark p-3 rounded-lg mb-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">参考图</p>
                          <label
                            className="px-2 py-1 rounded-lg glass-button text-[10px] cursor-pointer disabled:opacity-50"
                            title="上传参考图（用于一致性）"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {uploadingRefFor === element.id ? '上传中...' : '上传'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0]
                                e.currentTarget.value = ''
                                if (!file) return
                                  setUploadingRefFor(element.id)
                                  try {
                                    const result = await uploadFile(file)
                                    const url = (result.file.url || result.file.absoluteUrl || '').trim()
                                    if (!url) return
                                    const current = Array.isArray(element.reference_images) ? element.reference_images : []
                                    const payload = { reference_images: [...current, url] }
                                    if (onPersistElement) {
                                      await onPersistElement(element.id, payload)
                                    } else {
                                      onUpdateElement(element.id, payload)
                                    }
                                } catch (err) {
                                  console.error('上传参考图失败', err)
                                } finally {
                                  setUploadingRefFor(null)
                                }
                              }}
                            />
                          </label>
                        </div>
                        {Array.isArray(element.reference_images) && element.reference_images.length > 0 ? (
                          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                            {element.reference_images.map((url) => (
                              <div key={url} className="relative group/ref flex-shrink-0">
                                <img
                                  src={resolveMediaUrl(url)}
                                  alt="ref"
                                  className="w-16 h-12 rounded-lg object-cover border border-white/10 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const resolved = resolveMediaUrl(url)
                                    if (resolved) onPreviewImage(resolved, `${element.name} - 参考图`)
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    const resolved = resolveMediaUrl(url)
                                    if (!resolved) return

                                    const record = {
                                      id: `img_ref_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                                      url,
                                      source_url: url,
                                      created_at: new Date().toISOString(),
                                      is_favorite: true
                                    }
                                    const currentHistory = Array.isArray(element.image_history) ? element.image_history : []
                                    const nextHistory = [record, ...currentHistory]
                                    const payload: Partial<AgentElement> = {
                                      image_url: url,
                                      cached_image_url: url.startsWith('/api/uploads/') ? url : undefined,
                                      image_history: nextHistory
                                    }
                                    try {
                                      if (onPersistElement) {
                                        await onPersistElement(element.id, payload)
                                      } else {
                                        onUpdateElement(element.id, payload)
                                      }
                                    } catch (err) {
                                      console.error('设为元素图失败', err)
                                    }
                                  }}
                                  className="absolute -top-1 -left-1 w-5 h-5 rounded-full glass-dark opacity-0 group-hover/ref:opacity-100 transition-apple flex items-center justify-center"
                                  title="设为元素图（直接使用该图片）"
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const next = (element.reference_images || []).filter((u) => u !== url)
                                    const payload = { reference_images: next }
                                    if (onPersistElement) {
                                      void onPersistElement(element.id, payload)
                                    } else {
                                      onUpdateElement(element.id, payload)
                                    }
                                  }}
                                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full glass-dark opacity-0 group-hover/ref:opacity-100 transition-apple flex items-center justify-center"
                                  title="移除"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-gray-500 mt-2">
                            可上传角色/场景/道具参考图；生成镜头起始帧时会一并作为参考。
                          </p>
                        )}
                      </div>

                      {/* 图片历史画廊 */}
                      {(() => {
                        const history = Array.isArray(element.image_history) ? element.image_history : []
                        const candidates = [element.cached_image_url, element.image_url, history[0]?.url]
                        let currentRawUrl = ''
                        let currentDisplayUrl = ''
                        for (const candidate of candidates) {
                          if (!candidate) continue
                          const resolved = resolveMediaUrl(candidate)
                          if (!currentRawUrl) currentRawUrl = candidate
                          if (resolved) {
                            currentRawUrl = candidate
                            currentDisplayUrl = resolved
                            break
                          }
                        }

                        const currentImg = history.find((img) => img.url === currentRawUrl)
                        const isExpired = !!currentRawUrl && !currentDisplayUrl

                        if (history.length > 0) {
                          return (
                            <div className="space-y-3">
                              <div className="relative group">
                                {currentDisplayUrl ? (
                                  <img
                                    src={currentDisplayUrl}
                                    alt={element.name}
                                    className="w-full max-w-md rounded-xl cursor-pointer"
                                    onClick={() => onPreviewImage(currentDisplayUrl, element.name)}
                                  />
                                ) : (
                                  <div className="w-full max-w-md rounded-xl bg-black/30 border border-white/10 flex items-center justify-center text-xs text-gray-400 h-48">
                                    图片已过期（需重生成）
                                  </div>
                                )}

                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                                  <button
                                    onClick={() => currentDisplayUrl && onPreviewImage(currentDisplayUrl, element.name)}
                                    disabled={!currentDisplayUrl}
                                    className="p-2 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                                    title="放大查看"
                                  >
                                    <Maximize2 size={14} />
                                  </button>
                                  {currentImg ? (
                                    <button
                                      onClick={() => onFavoriteImage(element.id, currentImg.id)}
                                      className={`p-2 rounded-lg hover:bg-white/20 ${currentImg.is_favorite ? 'bg-yellow-400/80' : 'glass-dark'}`}
                                      title={currentImg.is_favorite ? '已收藏' : '点击收藏'}
                                    >
                                      <Star size={14} className={currentImg.is_favorite ? 'text-white fill-white' : 'text-white'} />
                                    </button>
                                  ) : null}
                                  <button
                                    onClick={() => onGenerateImage(element.id)}
                                    disabled={generatingElement === element.id}
                                    className="p-2 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                                    title="重新生成"
                                  >
                                    {generatingElement === element.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                  </button>
                                </div>

                                {currentImg?.is_favorite && (
                                  <div className="absolute top-2 left-2">
                                    <Star size={16} className="text-yellow-400 fill-yellow-400" />
                                  </div>
                                )}
                              </div>

                              {history.length > 1 && (
                                <div className="space-y-2">
                                  <p className="text-xs text-gray-500">历史版本 ({history.length}) - 点击切换</p>
                                  <div className="flex gap-2 overflow-x-auto pb-2">
                                    {history.map((img) => {
                                      const thumbUrl = resolveMediaUrl(img.url)
                                      const selected = img.url === currentRawUrl
                                      return (
                                        <div
                                          key={img.id}
                                          onClick={() => onFavoriteImage(element.id, img.id)}
                                          className={`relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden cursor-pointer group/thumb border-2 transition-all ${
                                            selected
                                              ? 'border-primary ring-2 ring-primary/50'
                                              : img.is_favorite
                                                ? 'border-yellow-400'
                                                : 'border-transparent hover:border-white/50'
                                          }`}
                                          title={thumbUrl ? '点击使用此图片' : '图片已过期'}
                                        >
                                          {thumbUrl ? (
                                            <img src={thumbUrl} alt={`${element.name} 版本`} className="w-full h-full object-cover" />
                                          ) : (
                                            <div className="w-full h-full bg-black/30 flex items-center justify-center text-[10px] text-gray-400">
                                              过期
                                            </div>
                                          )}

                                          {selected && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-primary/80 text-[10px] text-white text-center py-0.5">
                                              使用中
                                            </div>
                                          )}
                                          {img.is_favorite && !selected && (
                                            <div className="absolute top-1 right-1">
                                              <Star size={12} className="text-yellow-400 fill-yellow-400" />
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        }

                        if (currentDisplayUrl) {
                          return (
                            <div className="relative group">
                              <img
                                src={currentDisplayUrl}
                                alt={element.name}
                                className="w-full max-w-md rounded-xl cursor-pointer"
                                onClick={() => onPreviewImage(currentDisplayUrl, element.name)}
                              />
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                                <button
                                  onClick={() => onPreviewImage(currentDisplayUrl, element.name)}
                                  className="p-2 glass-dark rounded-lg hover:bg-white/20"
                                  title="放大查看"
                                >
                                  <Maximize2 size={14} />
                                </button>
                                <button
                                  onClick={() => onGenerateImage(element.id)}
                                  disabled={generatingElement === element.id}
                                  className="p-2 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                                  title="重新生成"
                                >
                                  {generatingElement === element.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                </button>
                              </div>
                            </div>
                          )
                        }

                        if (isExpired) {
                          return (
                            <div className="relative group">
                              <div className="w-full h-32 glass-card rounded-xl flex flex-col items-center justify-center border border-dashed border-white/20">
                                <span className="text-sm text-gray-400">图片已过期</span>
                                <span className="text-[10px] text-gray-500 mt-1">点击重新生成恢复显示</span>
                              </div>
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                                <button
                                  onClick={() => onGenerateImage(element.id)}
                                  disabled={generatingElement === element.id}
                                  className="p-2 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                                  title="重新生成"
                                >
                                  {generatingElement === element.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                </button>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <button
                            onClick={() => onGenerateImage(element.id)}
                            disabled={generatingElement === element.id}
                            className="w-full h-32 glass-card rounded-xl flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50"
                          >
                            {generatingElement === element.id ? (
                              <>
                                <Loader2 size={24} className="text-primary animate-spin mb-2" />
                                <span className="text-sm text-gray-400">生成中...</span>
                              </>
                            ) : (
                              <>
                                <Wand2 size={24} className="text-gray-500 mb-2" />
                                <span className="text-sm text-gray-400">点击生成图片</span>
                              </>
                            )}
                          </button>
                        )
                      })()}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setEditingElement(element.id)} className="flex-1 py-2 glass-button rounded-lg text-sm flex items-center justify-center gap-1"><Edit3 size={14} />编辑</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <button onClick={onAddElement} className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white hover:border-white/40 transition-apple flex items-center justify-center gap-2">
            <Plus size={18} />添加元素
          </button>
          {onAddElementFromImage && (
            <label
              className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white hover:border-white/40 transition-apple flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              title="从图片创建元素（适合续集直接沿用角色形象）"
              onClick={(e) => e.stopPropagation()}
            >
              {uploadingNewElement ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
              {uploadingNewElement ? '上传中...' : '从图片添加元素'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingNewElement}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.currentTarget.value = ''
                  if (!file) return
                  setUploadingNewElement(true)
                  try {
                    const result = await uploadFile(file)
                    const url = (result.file.url || result.file.absoluteUrl || '').trim()
                    if (!url) return
                    const name = (result.file.name || file.name || '').replace(/\.[^.]+$/, '')
                    await onAddElementFromImage({ url, name })
                  } catch (err) {
                    console.error('从图片添加元素失败', err)
                  } finally {
                    setUploadingNewElement(false)
                  }
                }}
              />
            </label>
          )}
        </>
      )}

      <FishVoiceLibraryModal
        isOpen={voicePickerFor !== null}
        onClose={() => setVoicePickerFor(null)}
        mode="pick"
        onPick={(model) => {
          if (!voicePickerFor) return
          onUpdateElement(voicePickerFor, { voice_profile: model.id })
          setVoicePickerFor(null)
        }}
      />
    </div>
  )
}


// 分镜面板
export function StoryboardPanel({
  segments, expandedSegments, toggleSegment, elements, onAddSegment,
  onGenerateFrames, onGenerateVideos, isGeneratingFrames, isGeneratingVideos,
  onRetryFrame, onRetryVideo, onFavoriteShotImage, onPreviewImage, retryingShot,
  onUpdateShotText,
  onScriptDoctor,
  onCompleteAssets,
  isScriptDoctoring,
  isCompletingAssets,
  visualStyle,
  focusShotRequest,
  onRegenerateShotAudio,
  regeneratingAudioShotId,
  onClearShotAudio,
  clearingAudioShotId,
  onOpenImportShotRefs,
  onRefineSplitVisuals,
  refiningSplitVisualsParentId
}: {
  segments: AgentSegment[]
  expandedSegments: Set<string>
  toggleSegment: (id: string) => void
  elements: Record<string, AgentElement>
  onAddSegment: () => void
  onGenerateFrames: () => void
  onGenerateVideos: () => void
  isGeneratingFrames: boolean
  isGeneratingVideos: boolean
  onRetryFrame: (shotId: string) => void
  onRetryVideo: (shotId: string) => void
  onFavoriteShotImage: (segmentId: string, shotId: string, imageId: string) => void
  onPreviewImage: (url: string, title: string) => void
  retryingShot: string | null
  onUpdateShotText: (shotId: string, updates: Partial<AgentShot>) => Promise<void>
  onScriptDoctor?: () => void
  onCompleteAssets?: () => void
  isScriptDoctoring?: boolean
  isCompletingAssets?: boolean
  visualStyle: string
  focusShotRequest?: { shotId: string; section?: 'video' | 'audio'; nonce: number } | null
  onRegenerateShotAudio?: (shotId: string) => void
  regeneratingAudioShotId?: string | null
  onClearShotAudio?: (shotId: string) => void
  clearingAudioShotId?: string | null
  onOpenImportShotRefs?: (shotId: string) => void
  onRefineSplitVisuals?: (parentShotId: string) => void
  refiningSplitVisualsParentId?: string | null
}) {
  const allShots = segments.flatMap(seg => seg.shots)
  const framesCompleted = allShots.filter(s => s.cached_start_image_url || (s.start_image_url && !isProbablyExpiredSignedUrl(s.start_image_url))).length
  const videosCompleted = allShots.filter(s => s.video_url).length
  const totalDuration = allShots.reduce((acc, s) => acc + (s.duration || 5), 0)
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gradient">分镜</h2>
          <p className="text-xs text-gray-500 mt-1">
            {segments.length} 段落 · {allShots.length} 镜头 · {Math.round(totalDuration)}秒
          </p>
        </div>
        {allShots.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end">
            {onScriptDoctor && (
              <button
                onClick={onScriptDoctor}
                disabled={Boolean(isScriptDoctoring) || isGeneratingFrames || isGeneratingVideos}
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                title="剧本增强：补齐 hook/高潮，提升逻辑与细节"
              >
                {isScriptDoctoring ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                剧本增强
              </button>
            )}
            {onCompleteAssets && (
              <button
                onClick={onCompleteAssets}
                disabled={Boolean(isCompletingAssets) || isGeneratingFrames || isGeneratingVideos}
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                title="补全场景/道具：提取缺失元素，并可补齐镜头提示词"
              >
                {isCompletingAssets ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                补全资产
              </button>
            )}
            <button onClick={onGenerateFrames} disabled={isGeneratingFrames || isGeneratingVideos} className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50">
              {isGeneratingFrames ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              起始帧 ({framesCompleted}/{allShots.length})
            </button>
            <button onClick={onGenerateVideos} disabled={isGeneratingFrames || isGeneratingVideos || framesCompleted === 0} className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50">
              {isGeneratingVideos ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
              视频 ({videosCompleted}/{allShots.length})
            </button>
          </div>
        )}
      </div>
      
      {/* 进度条 */}
      {allShots.length > 0 && (
        <div className="glass-card p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">起始帧</span>
            <span className="text-gray-500">{framesCompleted}/{allShots.length}</span>
          </div>
          <div className="h-2 glass rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all" style={{ width: `${(framesCompleted / allShots.length) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">视频</span>
            <span className="text-gray-500">{videosCompleted}/{allShots.length}</span>
          </div>
          <div className="h-2 glass rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all" style={{ width: `${(videosCompleted / allShots.length) * 100}%` }} />
          </div>
        </div>
      )}
      
      {segments.length === 0 ? (
        <div className="text-center py-12 glass-card rounded-2xl">
          <img
            src="/yuanyuan/confused.png"
            alt="等待中"
            className="w-20 h-20 mx-auto mb-4 object-contain"
          />
          <p className="text-gray-400 mb-4">还没有创建任何分镜</p>
          <p className="text-sm text-gray-500 mb-6">在右侧对话框描述你的项目，AI 会自动规划分镜</p>
          <button onClick={onAddSegment} className="px-4 py-2 glass-button rounded-xl text-sm">
            <Plus size={16} className="inline mr-2" />手动添加
          </button>
        </div>
      ) : (
        <>
          {segments.map((segment) => {
            const groupCounts: Record<string, number> = {}
            for (const s of segment.shots || []) {
              const base = String(s.id || '').replace(/_P\d+$/, '')
              if (!base) continue
              groupCounts[base] = (groupCounts[base] || 0) + 1
            }

            return (
              <div key={segment.id} id={`segment-${segment.id}`} className="glass-card overflow-hidden">
              <button onClick={() => toggleSegment(segment.id)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple">
                {expandedSegments.has(segment.id) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <span className="font-medium text-sm flex-1 text-left">{segment.name}</span>
                <span className="text-xs text-gray-500">{segment.shots.length} 镜头</span>
              </button>
              
              {expandedSegments.has(segment.id) && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-gray-400">{segment.description}</p>
                  {segment.shots.map((shot) => {
                    const base = String(shot.id || '').replace(/_P\d+$/, '')
                    const showRefine = Boolean(base && (groupCounts[base] || 0) > 1)
                    return (
                      <ShotCard 
                        key={shot.id} 
                        shot={shot} 
                        segmentId={segment.id}
                        elements={elements}
                        onRetryFrame={onRetryFrame}
                        onRetryVideo={onRetryVideo}
                        onFavoriteImage={onFavoriteShotImage}
                        onPreviewImage={onPreviewImage}
                        isRetrying={retryingShot === shot.id}
                        onUpdateShotText={onUpdateShotText}
                        visualStyle={visualStyle}
                        focus={focusShotRequest && focusShotRequest.shotId === shot.id ? focusShotRequest : null}
                        onRegenerateAudio={onRegenerateShotAudio}
                        regeneratingAudio={Boolean(regeneratingAudioShotId && regeneratingAudioShotId === shot.id)}
                        onClearAudio={onClearShotAudio}
                        clearingAudio={Boolean(clearingAudioShotId && clearingAudioShotId === shot.id)}
                        onOpenImportShotRefs={onOpenImportShotRefs}
                        onRefineSplitVisuals={onRefineSplitVisuals}
                        refineSplitVisualsParentShotId={showRefine ? base : null}
                        refiningSplitVisualsParentId={refiningSplitVisualsParentId}
                      />
                    )
                  })}
                  <button className="w-full p-3 glass border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white text-sm flex items-center justify-center gap-2">
                    <Plus size={16} />添加镜头
                  </button>
                </div>
              )}
            </div>
            )
          })}
          <button onClick={onAddSegment} className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white transition-apple flex items-center justify-center gap-2">
            <Plus size={18} />添加段落
          </button>
        </>
      )}
    </div>
  )
}

// 镜头卡片
export function ShotCard({ 
  shot, 
  segmentId,
  elements,
  onRetryFrame,
  onRetryVideo,
  onFavoriteImage,
  onPreviewImage,
  isRetrying,
  onUpdateShotText,
  visualStyle,
  focus,
  onRegenerateAudio,
  regeneratingAudio,
  onClearAudio,
  clearingAudio,
  onOpenImportShotRefs,
  onRefineSplitVisuals,
  refineSplitVisualsParentShotId,
  refiningSplitVisualsParentId
}: { 
  shot: AgentShot
  segmentId: string
  elements: Record<string, AgentElement>
  onRetryFrame: (shotId: string) => void
  onRetryVideo: (shotId: string) => void
  onFavoriteImage: (segmentId: string, shotId: string, imageId: string) => void
  onPreviewImage: (url: string, title: string) => void
  isRetrying: boolean
  onUpdateShotText: (shotId: string, updates: Partial<AgentShot>) => Promise<void>
  visualStyle: string
  focus?: { shotId: string; section?: 'video' | 'audio'; nonce: number } | null
  onRegenerateAudio?: (shotId: string) => void
  regeneratingAudio?: boolean
  onClearAudio?: (shotId: string) => void
  clearingAudio?: boolean
  onOpenImportShotRefs?: (shotId: string) => void
  onRefineSplitVisuals?: (parentShotId: string) => void
  refineSplitVisualsParentShotId?: string | null
  refiningSplitVisualsParentId?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingText, setEditingText] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState(shot.prompt || '')
  const [draftNarration, setDraftNarration] = useState(shot.narration || '')
  const [draftVideoPrompt, setDraftVideoPrompt] = useState(shot.video_prompt || '')
  const [draftDialogueScript, setDraftDialogueScript] = useState(shot.dialogue_script || '')
  const [savingText, setSavingText] = useState(false)
  const [highlighted, setHighlighted] = useState(false)
  const [uploadingShotRef, setUploadingShotRef] = useState(false)

  useEffect(() => {
    if (editingText) return
    setDraftPrompt(shot.prompt || '')
    setDraftNarration(shot.narration || '')
    setDraftVideoPrompt(shot.video_prompt || '')
    setDraftDialogueScript(shot.dialogue_script || '')
  }, [shot.prompt, shot.narration, shot.video_prompt, shot.dialogue_script, editingText])
  
  const resolvedPrompt = shot.prompt?.replace(/\[Element_(\w+)\]/g, (match, id) => {
    const fullId = `Element_${id}`
    const element = elements[fullId]
    return element ? `[${element.name}]` : match
  }) || shot.description

  const resolvedVideoPrompt = (shot.video_prompt || '').replace(/\[Element_(\w+)\]/g, (match, id) => {
    const fullId = `Element_${id}`
    const element = elements[fullId]
    return element ? `[${element.name}]` : match
  })

  const dialoguePreview = (shot.dialogue_script || '').trim()
  const shotRefs = Array.isArray(shot.reference_images) ? shot.reference_images : []

  const resolveMediaUrl = (url?: string | null) => {
	    const u = (url || '').trim()
	    if (!u) return ''
	    if (/^(https?:|data:|blob:)/i.test(u)) return isProbablyExpiredSignedUrl(u) ? '' : u
	    if (u.startsWith('/api/')) return `http://localhost:8001${u}`
	    return u
	  }

  const startFrameHistory = Array.isArray(shot.start_image_history) ? shot.start_image_history : []
  const startFrameCandidates = [shot.cached_start_image_url, shot.start_image_url, startFrameHistory[0]?.url]
  let currentStartFrameRawUrl = ''
  let currentStartFrameUrl = ''
  for (const candidate of startFrameCandidates) {
    if (!candidate) continue
    const resolved = resolveMediaUrl(candidate)
    if (!currentStartFrameRawUrl) currentStartFrameRawUrl = candidate
    if (resolved) {
      currentStartFrameRawUrl = candidate
      currentStartFrameUrl = resolved
      break
    }
  }

  const defaultVideoPromptPreview = `${resolvedPrompt}，${visualStyle || '吉卜力动画风格'}，自然流畅的动作与镜头运动，音频：旁白逐字一致，固定同一音色，不要无关对白，no subtitles, no on-screen text`
  
  const shotTypeLabels: Record<string, string> = {
    standard: '标准叙事', quick: '快速切换', closeup: '特写', wide: '远景', montage: '蒙太奇'
  }
  
  const getStatusIcon = () => {
    if (shot.video_url) return <CheckCircle size={14} className="text-green-400" />
    if (currentStartFrameUrl) return <ImageIcon size={14} className="text-blue-400" />
    return <AlertCircle size={14} className="text-yellow-400" />
  }
  
  // 检查当前起始帧是否被收藏
  const currentImageFavorited = shot.start_image_history?.find(img => img.url === currentStartFrameRawUrl)?.is_favorite

  useEffect(() => {
    if (!focus?.nonce) return
    if (focus.shotId !== shot.id) return

    setExpanded(true)
    setHighlighted(true)
    const t = window.setTimeout(() => setHighlighted(false), 1600)

    if (focus.section) {
      setEditingText(true)
    }

    // 等待展开渲染完成后滚动到对应区域
    const scrollTargetId =
      focus.section === 'audio'
        ? `shot-${shot.id}-narration`
        : focus.section === 'video'
          ? `shot-${shot.id}-prompt`
          : `shot-${shot.id}`

    const s1 = window.setTimeout(() => {
      document.getElementById(scrollTargetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    const s2 = window.setTimeout(() => {
      document.getElementById(scrollTargetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 260)

    return () => {
      window.clearTimeout(t)
      window.clearTimeout(s1)
      window.clearTimeout(s2)
    }
  }, [focus?.nonce, focus?.section, focus?.shotId, shot.id])
  
  return (
    <div id={`shot-${shot.id}`} className={`glass p-4 rounded-xl ${highlighted ? 'ring-2 ring-yellow-400/70' : ''}`}>
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <span className="text-sm font-medium flex-1">{shot.name}</span>
        {getStatusIcon()}
        <span className="text-xs text-gray-500 px-2 py-0.5 glass rounded-full">{shotTypeLabels[shot.type] || shot.type}</span>
        <span className="text-xs text-gray-500">{shot.duration}s</span>
      </div>
      
      {expanded && (
        <div className="mt-3 pl-6 space-y-3">
          <p className="text-xs text-gray-500">{shot.description}</p>

          <div className="flex items-center justify-end gap-2">
            {onRefineSplitVisuals && refineSplitVisualsParentShotId && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRefineSplitVisuals(refineSplitVisualsParentShotId)
                }}
                disabled={Boolean(refiningSplitVisualsParentId && refiningSplitVisualsParentId === refineSplitVisualsParentShotId)}
                className="px-3 py-1.5 glass-button rounded-lg text-xs text-cyan-200 disabled:opacity-50"
                title="AI 一键精修该拆分镜头组的画面提示词（需要重生成起始帧/视频生效）"
              >
                {refiningSplitVisualsParentId && refiningSplitVisualsParentId === refineSplitVisualsParentShotId ? '精修中...' : 'AI 精修本组画面'}
              </button>
            )}
            {onClearAudio && Boolean((shot as { voice_audio_url?: string }).voice_audio_url) && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClearAudio(shot.id)
                }}
                disabled={Boolean(clearingAudio) || Boolean(regeneratingAudio)}
                className="px-3 py-1.5 glass-button rounded-lg text-xs text-red-300 disabled:opacity-50"
                title="删除该镜头已生成的人声轨（旁白/对白）音频"
              >
                {clearingAudio ? '删除中...' : '删除音频(本镜头)'}
              </button>
            )}
            {onRegenerateAudio && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRegenerateAudio(shot.id)
                }}
                disabled={Boolean(regeneratingAudio)}
                className="px-3 py-1.5 glass-button rounded-lg text-xs disabled:opacity-50"
                title="仅重新生成该镜头的旁白/对白音频"
              >
                {regeneratingAudio ? '生成中...' : '重新生成音频(本镜头)'}
              </button>
            )}
          </div>
          
          <div id={`shot-${shot.id}-prompt`} className="glass-dark p-3 rounded-lg">
            <div className="flex items-center justify-between mb-1 gap-2">
              <p className="text-xs text-gray-400">提示词</p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setEditingText(v => !v)
                }}
                className="px-2 py-1 glass rounded-lg text-[10px] text-gray-300 hover:bg-white/10 flex items-center gap-1"
                title="编辑提示词/旁白（不自动重生成）"
              >
                <Edit3 size={12} />
                {editingText ? '收起' : '编辑'}
              </button>
            </div>
            {editingText ? (
              <textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                rows={4}
                className="w-full glass-dark rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50"
                placeholder="请输入该镜头的起始帧提示词（支持 [Element_XXX] 引用）。"
              />
            ) : (
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{resolvedPrompt}</p>
            )}
            {editingText && (
              <p className="mt-2 text-[10px] text-gray-500">
                仅修改文本，不会自动重生成；需要出图请点击「生成/重新生成」。
              </p>
            )}
          </div>

          <div className="glass-dark p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">视频提示词（用于视频生成）</p>
            {editingText ? (
              <textarea
                value={draftVideoPrompt}
                onChange={(e) => setDraftVideoPrompt(e.target.value)}
                rows={4}
                className="w-full glass-dark rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50"
                placeholder="可选：单独设置视频提示词（留空则自动用“起始帧提示词+旁白+运动/音频规则”组合）。"
              />
            ) : (
              <>
                {resolvedVideoPrompt.trim() ? (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{resolvedVideoPrompt}</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-1">（未单独设置，当前会自动组合生成）</p>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{defaultVideoPromptPreview}</p>
                  </>
                )}
              </>
            )}
          </div>

          <div className="glass-dark p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">人物对白脚本（B 方案）</p>
            {editingText ? (
              <textarea
                value={draftDialogueScript}
                onChange={(e) => setDraftDialogueScript(e.target.value)}
                rows={4}
                className="w-full glass-dark rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50"
                placeholder={"示例：\n狐狸: 你看，那边有一群鹅！\n狼: 太好了！\n\n可留空（只旁白）。"}
              />
            ) : dialoguePreview ? (
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{dialoguePreview}</p>
            ) : (
              <p className="text-xs text-gray-500">（未填写对白脚本：当前主要依赖旁白/无对白）</p>
            )}
          </div>
          
          <div id={`shot-${shot.id}-narration`} className="glass-dark p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">旁白</p>
            {editingText ? (
              <textarea
                value={draftNarration}
                onChange={(e) => setDraftNarration(e.target.value)}
                rows={2}
                className="w-full glass-dark rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50"
                placeholder="可选：输入该镜头旁白（留空则不显示）。"
              />
            ) : shot.narration ? (
              <p className="text-sm text-gray-300 italic whitespace-pre-wrap">"{shot.narration}"</p>
            ) : (
              <p className="text-xs text-gray-500">（暂无旁白）</p>
            )}

            {editingText && (
              <div className="mt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setEditingText(false)
                    setDraftPrompt(shot.prompt || '')
                    setDraftNarration(shot.narration || '')
                  }}
                  disabled={savingText}
                  className="px-3 py-1.5 glass rounded-lg text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setSavingText(true)
                    try {
                      await onUpdateShotText(shot.id, { prompt: draftPrompt, video_prompt: draftVideoPrompt, dialogue_script: draftDialogueScript, narration: draftNarration })
                      setEditingText(false)
                    } finally {
                      setSavingText(false)
                    }
                  }}
                  disabled={savingText}
                  className="px-3 py-1.5 glass-button rounded-lg text-xs disabled:opacity-50"
                >
                  {savingText ? '保存中...' : '保存'}
                </button>
              </div>
            )}
          </div>

          {/* 参考图（用于场景/道具对齐；会在生成起始帧时一并传入） */}
          <div className="glass-dark p-3 rounded-lg">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400">参考图</p>
              <div className="flex items-center gap-2">
                {onOpenImportShotRefs && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onOpenImportShotRefs(shot.id)
                    }}
                    className="px-2 py-1 rounded-lg glass-button text-[10px] disabled:opacity-50 flex items-center gap-1"
                    title="从其他项目导入镜头参考图"
                  >
                    <Download size={12} />
                    导入
                  </button>
                )}
                <label
                  className="px-2 py-1 rounded-lg glass-button text-[10px] cursor-pointer disabled:opacity-50"
                  title="上传参考图（场景/道具/上一镜头）"
                  onClick={(e) => e.stopPropagation()}
                >
                  {uploadingShotRef ? '上传中...' : '上传'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.currentTarget.value = ''
                      if (!file) return
                      setUploadingShotRef(true)
                      try {
                        const result = await uploadFile(file)
                        const url = (result.file.url || result.file.absoluteUrl || '').trim()
                        if (!url) return
                        await onUpdateShotText(shot.id, { reference_images: [...shotRefs, url] })
                      } catch (err) {
                        console.error('上传镜头参考图失败', err)
                      } finally {
                        setUploadingShotRef(false)
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            {shotRefs.length > 0 ? (
              <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                {shotRefs.map((url) => (
                  <div key={url} className="relative group/ref flex-shrink-0">
                    <img
                      src={resolveMediaUrl(url)}
                      alt="ref"
                      className="w-16 h-12 rounded-lg object-cover border border-white/10 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        const resolved = resolveMediaUrl(url)
                        if (resolved) onPreviewImage(resolved, `${shot.name} - 参考图`)
                      }}
                    />
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const next = shotRefs.filter((u) => u !== url)
                        await onUpdateShotText(shot.id, { reference_images: next })
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full glass-dark opacity-0 group-hover/ref:opacity-100 transition-apple flex items-center justify-center"
                      title="移除"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-500 mt-2">
                可上传场景/道具/上一镜头参考图；系统会在生成起始帧时同时使用角色参考与这些参考图。
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {/* 起始帧区域 */}
            {currentStartFrameRawUrl ? (
              <div className="flex-1 space-y-2">
                {/* 当前起始帧 */}
                <div className="relative group">
                  {currentStartFrameUrl ? (
                    <img 
                      src={currentStartFrameUrl} 
                      alt={shot.name} 
                      className="w-full rounded-lg cursor-pointer"
                      onClick={() => onPreviewImage(currentStartFrameUrl, shot.name)}
                    />
                  ) : (
                    <div className="w-full h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20">
                      <span className="text-xs text-gray-400">起始帧已过期</span>
                      <span className="text-[10px] text-gray-500 mt-1">点击重新生成恢复显示</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-apple rounded-lg flex items-center justify-center gap-2">
                    {/* 放大查看按钮 */}
                    <button 
                      onClick={() => currentStartFrameUrl && onPreviewImage(currentStartFrameUrl, shot.name)}
                      disabled={!currentStartFrameUrl}
                      className="p-2 glass rounded-lg hover:bg-white/20 disabled:opacity-50"
                      title="放大查看"
                    >
                      <Maximize2 size={14} />
                    </button>
                    {/* 收藏按钮 */}
                    {(() => {
                      const currentImg = shot.start_image_history?.find(img => img.url === currentStartFrameRawUrl)
                      if (currentImg) {
                        return (
                          <button 
                            onClick={() => onFavoriteImage(segmentId, shot.id, currentImg.id)}
                            className={`p-2 rounded-lg hover:bg-white/20 ${currentImg.is_favorite ? 'bg-yellow-400/80' : 'glass'}`}
                            title={currentImg.is_favorite ? '已收藏' : '点击收藏'}
                          >
                            <Star size={14} className={currentImg.is_favorite ? 'text-white fill-white' : 'text-white'} />
                          </button>
                        )
                      }
                      return null
                    })()}
                    {/* 重新生成按钮 */}
                    <button 
                      onClick={() => onRetryFrame(shot.id)}
                      disabled={isRetrying}
                      className="p-2 glass rounded-lg hover:bg-white/20 disabled:opacity-50"
                      title="重新生成"
                    >
                      {isRetrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    </button>
                  </div>
                  {/* 收藏标记 */}
                  {currentImageFavorited && (
                    <div className="absolute top-2 left-2">
                      <Star size={14} className="text-yellow-400 fill-yellow-400" />
                    </div>
                  )}
                </div>
                
                {/* 起始帧历史缩略图 */}
                {shot.start_image_history && shot.start_image_history.length > 1 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-gray-500">历史版本 ({shot.start_image_history.length}) - 点击切换</p>
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {shot.start_image_history.map((img) => {
                        const thumbUrl = resolveMediaUrl(img.url)
                        const selected = img.url === currentStartFrameRawUrl
                        return (
                          <div 
                            key={img.id} 
                            onClick={() => onFavoriteImage(segmentId, shot.id, img.id)}
                            className={`relative flex-shrink-0 w-14 h-10 rounded overflow-hidden cursor-pointer group/thumb border-2 transition-all ${
                              selected
                                ? 'border-primary ring-1 ring-primary/50' 
                                : img.is_favorite 
                                  ? 'border-yellow-400' 
                                  : 'border-transparent hover:border-white/50'
                            }`}
                            title={thumbUrl ? '点击使用此图片' : '图片已过期'}
                          >
                            {thumbUrl ? (
                              <img 
                                src={thumbUrl} 
                                alt={`${shot.name} 版本`} 
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-black/30 flex items-center justify-center text-[8px] text-gray-400">
                                过期
                              </div>
                            )}
                          {/* 当前使用标记 */}
                          {selected && (
                            <div className="absolute bottom-0 left-0 right-0 bg-primary/80 text-[8px] text-white text-center py-0.5">
                              使用中
                            </div>
                          )}
                          {/* 收藏标记 */}
                          {img.is_favorite && !selected && (
                            <div className="absolute top-0.5 right-0.5">
                              <Star size={10} className="text-yellow-400 fill-yellow-400" />
                            </div>
                          )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button 
                onClick={() => onRetryFrame(shot.id)}
                disabled={isRetrying}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">生成中...</span></>
                ) : (
                  <><ImageIcon size={20} className="text-gray-500 mb-1" /><span className="text-xs text-gray-500">点击生成起始帧</span></>
                )}
              </button>
            )}
            
            {shot.video_url ? (
              <div className="relative group flex-1">
                <video 
                  src={shot.video_url} 
                  className="w-full rounded-lg" 
                  controls
                  muted
                  playsInline
                />
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-apple">
                  <button 
                    onClick={() => onRetryVideo(shot.id)}
                    disabled={isRetrying}
                    className="p-1.5 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                    title="重新生成视频"
                  >
                    {isRetrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  </button>
                </div>
              </div>
            ) : shot.status === 'video_failed' ? (
              <button 
                onClick={() => onRetryVideo(shot.id)}
                disabled={isRetrying || !shot.start_image_url}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-red-500/50 hover:border-red-400 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">重新生成中...</span></>
                ) : (
                  <><AlertCircle size={20} className="text-red-400 mb-1" /><span className="text-xs text-red-400">生成失败，点击重试</span></>
                )}
              </button>
            ) : shot.start_image_url ? (
              <button 
                onClick={() => onRetryVideo(shot.id)}
                disabled={isRetrying}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">生成中...</span></>
                ) : (
                  <><Film size={20} className="text-gray-500 mb-1" /><span className="text-xs text-gray-500">点击生成视频</span></>
                )}
              </button>
            ) : (
              <div className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20">
                <Film size={20} className="text-gray-500 mb-1" />
                <span className="text-xs text-gray-500">需先生成起始帧</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// 图片预览 Modal
export function ImagePreviewModal({ 
  image, 
  onClose 
}: { 
  image: { url: string; title: string } | null
  onClose: () => void 
}) {
  if (!image) return null
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <img 
          src={image.url} 
          alt={image.title}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass px-4 py-2 rounded-lg">
          <p className="text-sm text-white">{image.title}</p>
        </div>
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 glass rounded-full hover:bg-white/20 transition-apple"
          title="关闭"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  )
}
