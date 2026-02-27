/**
 * 功能模块：Studio 组件模块，素材库面板（ElementLibraryPanel）
 */

import { useState } from 'react'
import {
  X, Star, Pencil, Trash2, Loader2, Play, ImageIcon,
} from 'lucide-react'
import type {
  StudioElement,
  StudioEpisodeElement,
  StudioGenerationScope,
} from '../../store/studioStore'
import HoverOverviewPanel from './HoverOverviewPanel'
import ElementEditDialog from './ElementEditDialog'
import ImageHistoryDialog from './ImageHistoryDialog'

export default function ElementLibraryPanel({
  sharedElements,
  episodeElements,
  onUpdateSharedElement,
  onDeleteSharedElement,
  onGenerateSharedElementImage,
  onBatchGenerateMissingSharedElements,
  generating = false,
  generationScope = 'none',
  onClose,
}: {
  sharedElements: StudioElement[]
  episodeElements: StudioEpisodeElement[]
  onUpdateSharedElement?: (elementId: string, updates: Record<string, unknown>) => void | Promise<void>
  onDeleteSharedElement?: (elementId: string) => void | Promise<void>
  onGenerateSharedElementImage?: (
    elementId: string,
    options?: { useReference?: boolean; referenceMode?: 'none' | 'light' | 'full' }
  ) => void | Promise<void>
  onBatchGenerateMissingSharedElements?: () => void | Promise<void>
  generating?: boolean
  generationScope?: StudioGenerationScope
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [editingElement, setEditingElement] = useState<StudioElement | null>(null)
  const [historyElement, setHistoryElement] = useState<StudioElement | null>(null)
  const [characterRefModeMap, setCharacterRefModeMap] = useState<Record<string, 'none' | 'light' | 'full'>>({})

  const norm = keyword.trim().toLowerCase()
  const filterByKeyword = (name: string, desc: string) =>
    !norm || `${name} ${desc}`.toLowerCase().includes(norm)

  const sharedFiltered = sharedElements.filter((el) => {
    if (typeFilter !== 'all' && el.type !== typeFilter) return false
    if (favoriteOnly && el.is_favorite !== 1) return false
    return filterByKeyword(el.name, el.description)
  })
  const sharedMissingCount = sharedFiltered.filter((el) => !el.image_url).length
  const isBatchGenerating = generating && generationScope === 'batch'

  const episodeOnly = episodeElements.filter((el) => !el.shared_element_id).filter((el) => {
    if (typeFilter !== 'all' && el.type !== typeFilter) return false
    return filterByKeyword(el.name, el.description)
  })

  const getCharacterRefMode = (element: StudioElement): 'none' | 'light' | 'full' => {
    if (element.type !== 'character') return 'none'
    return characterRefModeMap[element.id] || 'light'
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-100">素材库</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 border-b border-gray-800 space-y-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索名称或描述..."
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'character', 'scene', 'object'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-1 rounded text-xs ${
                  typeFilter === type ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {type === 'all' ? '全部' : type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具'}
              </button>
            ))}
            <button
              onClick={() => setFavoriteOnly((v) => !v)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                favoriteOnly ? 'bg-yellow-700/50 text-yellow-200' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Star className="w-3 h-3" />
              仅收藏
            </button>
            {onBatchGenerateMissingSharedElements && (
              <button
                onClick={() => onBatchGenerateMissingSharedElements()}
                disabled={generating || sharedMissingCount <= 0}
                className="px-2 py-1 rounded text-xs bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40 inline-flex items-center gap-1 transition-colors"
                title="批量生成当前筛选中缺少参考图的共享素材"
              >
                {isBatchGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                批量生成缺图({sharedMissingCount})
              </button>
            )}
          </div>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-130px)] space-y-5">
          <section>
            <h4 className="text-sm font-medium text-gray-300 mb-2">系列共享素材（{sharedFiltered.length}）</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {sharedFiltered.map((el) => (
                <div key={el.id} className="group relative p-3 rounded-lg border border-gray-800 bg-gray-950/60">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{el.type}</span>
                    <span className="text-sm text-gray-200 truncate">{el.name}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {onUpdateSharedElement && (
                        <button
                          onClick={() => onUpdateSharedElement(el.id, { is_favorite: el.is_favorite === 1 ? 0 : 1 })}
                          className={`${el.is_favorite === 1 ? 'text-yellow-300' : 'text-gray-500 hover:text-yellow-300'} transition-colors`}
                          title={el.is_favorite === 1 ? '取消收藏' : '收藏'}
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onUpdateSharedElement && (
                        <button
                          onClick={() => setEditingElement(el)}
                          className="text-gray-500 hover:text-white transition-colors"
                          title="编辑素材"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDeleteSharedElement && (
                        <button
                          onClick={() => {
                            if (confirm(`确定删除素材「${el.name}」吗？`)) onDeleteSharedElement(el.id)
                          }}
                          className="text-gray-500 hover:text-red-400 transition-colors"
                          title="删除素材"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {el.image_url ? (
                    <img src={el.image_url} alt={el.name} className="w-full h-24 rounded object-cover mb-2" />
                  ) : (
                    <div className="w-full h-24 rounded bg-gray-800 mb-2 flex items-center justify-center text-gray-600">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                  )}
                  <p className="text-xs text-gray-400 line-clamp-3">{el.description}</p>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {el.type === 'character' && (
                      <select
                        value={getCharacterRefMode(el)}
                        onChange={(e) => {
                          const next = e.target.value as 'none' | 'light' | 'full'
                          setCharacterRefModeMap((prev) => ({ ...prev, [el.id]: next }))
                        }}
                        disabled={generating}
                        className="text-[11px] px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-purple-500 disabled:opacity-40"
                        title="角色一致性参考强度"
                      >
                        <option value="none">一致性: 关</option>
                        <option value="light">一致性: 轻</option>
                        <option value="full">一致性: 强</option>
                      </select>
                    )}
                    {onGenerateSharedElementImage && (
                      <button
                        onClick={() => {
                          const mode = getCharacterRefMode(el)
                          onGenerateSharedElementImage(el.id, {
                            useReference: el.type === 'character' && mode !== 'none',
                            referenceMode: el.type === 'character' ? mode : 'none',
                          })
                        }}
                        disabled={generating}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        title={el.type === 'character' ? '角色可按一致性档位重做参考图' : undefined}
                      >
                        {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        {el.image_url ? (el.type === 'character' ? '一致性重做参考图' : '重做参考图') : '生成参考图'}
                      </button>
                    )}
                    {onUpdateSharedElement && el.image_history && el.image_history.length > 0 && (
                      <button
                        onClick={() => setHistoryElement(el)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                      >
                        历史({el.image_history.length})
                      </button>
                    )}
                  </div>

                  <HoverOverviewPanel maxWidthClass="max-w-4xl">
                    <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
                      <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
                        <div className="aspect-video w-full bg-gray-900/80">
                          {el.image_url ? (
                            <img src={el.image_url} alt={el.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <ImageIcon className="w-10 h-10" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-base text-gray-100 font-semibold line-clamp-1">{el.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{el.type}</span>
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed line-clamp-8">
                          {el.description || '暂无描述'}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                            出现集数: {el.appears_in_episodes?.length || 0}
                          </div>
                          <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                            图像版本: {el.image_history?.length || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                  </HoverOverviewPanel>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-medium text-gray-300">本集特有素材（{episodeOnly.length}）</h4>
              <span className="text-[11px] text-gray-500">当前支持在镜头详情中直接生成，后续会补齐独立生成</span>
            </div>
            {episodeOnly.length === 0 ? (
              <p className="text-xs text-gray-500">暂无本集特有素材</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {episodeOnly.map((el) => (
                  <div key={el.id} className="group relative p-3 rounded-lg border border-gray-800 bg-gray-950/60">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300">{el.type}</span>
                      <span className="text-sm text-gray-200 truncate">{el.name}</span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-3">{el.description}</p>

                    <HoverOverviewPanel maxWidthClass="max-w-2xl">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-base text-gray-100 font-semibold line-clamp-1">{el.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-300">{el.type}</span>
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed line-clamp-8">
                          {el.description || '暂无描述'}
                        </p>
                        <div className="text-xs text-gray-500 flex items-center justify-between">
                          <span>本集特有素材</span>
                          <span>{el.image_url ? '含参考图' : '无参考图'}</span>
                        </div>
                      </div>
                    </HoverOverviewPanel>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {editingElement && onUpdateSharedElement && (
        <ElementEditDialog
          initial={editingElement}
          onClose={() => setEditingElement(null)}
          onSubmit={(payload) => {
            onUpdateSharedElement(editingElement.id, payload)
            setEditingElement(null)
          }}
        />
      )}

      {historyElement && onUpdateSharedElement && (
        <ImageHistoryDialog
          title={`${historyElement.name} · 图片历史`}
          current={historyElement.image_url}
          history={historyElement.image_history || []}
          onClose={() => setHistoryElement(null)}
          onApply={(url) => {
            onUpdateSharedElement(historyElement.id, { image_url: url })
            setHistoryElement(null)
          }}
        />
      )}

    </div>
  )
}
