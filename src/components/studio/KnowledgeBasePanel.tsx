/**
 * 知识库管理面板
 * 提供角色档案、场景档案、情绪氛围包、世界观词典 四个 Tab 的管理界面
 */

import { useState, useEffect, useCallback } from 'react'
import {
  X, Loader2, RefreshCw, Users, MapPin, Palette, BookOpen,
  ChevronDown, ChevronRight, Save,
} from 'lucide-react'
import {
  fetchKBCharacterCards,
  syncKBCharacterCard,
  fetchKBSceneCards,
  syncKBSceneCard,
  fetchKBMoodPacks,
  fetchKBWorldBible,
  updateKBWorldBible,
  syncAllKB,
} from '../../services/api'
import type {
  KBCharacterCard,
  KBSceneCard,
  KBMoodPack,
  KBWorldBible,
} from '../../services/api'

interface KnowledgeBasePanelProps {
  seriesId: string
  onClose?: () => void
}

type TabKey = 'characters' | 'scenes' | 'moods' | 'world'

const TAB_META: Array<{ key: TabKey; label: string; icon: typeof Users }> = [
  { key: 'characters', label: '角色档案', icon: Users },
  { key: 'scenes', label: '场景档案', icon: MapPin },
  { key: 'moods', label: '情绪氛围包', icon: Palette },
  { key: 'world', label: '世界观词典', icon: BookOpen },
]

const MOOD_COLORS: Record<string, string> = {
  tense: 'bg-red-600/30 border-red-500/50 text-red-200',
  hopeful: 'bg-amber-600/30 border-amber-500/50 text-amber-200',
  melancholic: 'bg-blue-600/30 border-blue-500/50 text-blue-200',
  romantic: 'bg-pink-600/30 border-pink-500/50 text-pink-200',
  comedic: 'bg-yellow-600/30 border-yellow-500/50 text-yellow-200',
  mysterious: 'bg-purple-600/30 border-purple-500/50 text-purple-200',
  epic: 'bg-orange-600/30 border-orange-500/50 text-orange-200',
  serene: 'bg-emerald-600/30 border-emerald-500/50 text-emerald-200',
}

const MOOD_LABELS: Record<string, string> = {
  tense: '紧张',
  hopeful: '希望',
  melancholic: '忧郁',
  romantic: '浪漫',
  comedic: '喜剧',
  mysterious: '神秘',
  epic: '史诗',
  serene: '宁静',
}

export default function KnowledgeBasePanel({ seriesId, onClose }: KnowledgeBasePanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('characters')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  // Data
  const [characters, setCharacters] = useState<KBCharacterCard[]>([])
  const [scenes, setScenes] = useState<KBSceneCard[]>([])
  const [moods, setMoods] = useState<KBMoodPack[]>([])
  const [worldBible, setWorldBible] = useState<KBWorldBible | null>(null)
  const [savingWorld, setSavingWorld] = useState(false)

  // Expanded card IDs
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [chars, scns, mds, bible] = await Promise.all([
        fetchKBCharacterCards(seriesId).catch(() => []),
        fetchKBSceneCards(seriesId).catch(() => []),
        fetchKBMoodPacks(seriesId).catch(() => []),
        fetchKBWorldBible(seriesId).catch(() => null),
      ])
      setCharacters(chars)
      setScenes(scns)
      setMoods(mds)
      setWorldBible(bible)
    } finally {
      setLoading(false)
    }
  }, [seriesId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const handleSyncAll = async () => {
    setSyncing(true)
    try {
      await syncAllKB(seriesId)
      await loadAll()
    } catch (err) {
      console.error('一键同步失败:', err)
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncCharacter = async (elementId: string) => {
    setSyncingId(elementId)
    try {
      const updated = await syncKBCharacterCard(elementId)
      setCharacters((prev) =>
        prev.map((c) => (c.element_id === elementId ? updated : c))
      )
    } catch (err) {
      console.error('同步角色卡失败:', err)
    } finally {
      setSyncingId(null)
    }
  }

  const handleSyncScene = async (elementId: string) => {
    setSyncingId(elementId)
    try {
      const updated = await syncKBSceneCard(elementId)
      setScenes((prev) =>
        prev.map((s) => (s.element_id === elementId ? updated : s))
      )
    } catch (err) {
      console.error('同步场景卡失败:', err)
    } finally {
      setSyncingId(null)
    }
  }

  const handleSaveWorldBible = async () => {
    if (!worldBible) return
    setSavingWorld(true)
    try {
      const updated = await updateKBWorldBible(seriesId, worldBible)
      setWorldBible(updated)
    } catch (err) {
      console.error('保存世界观失败:', err)
    } finally {
      setSavingWorld(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-gray-100">知识库管理</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="px-3 py-1.5 rounded text-xs bg-purple-700/60 hover:bg-purple-600/60 text-purple-100 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              一键同步
            </button>
            {onClose && (
              <button onClick={onClose} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex gap-1 shrink-0">
          {TAB_META.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-2 text-xs rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                activeTab === key
                  ? 'border-purple-500 text-purple-200 bg-gray-800/60'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            </div>
          ) : (
            <>
              {/* Characters Tab */}
              {activeTab === 'characters' && (
                <div className="space-y-3">
                  {characters.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">暂无角色档案，点击"一键同步"从共享元素导入</p>
                  ) : (
                    characters.map((card) => (
                      <div key={card.id} className="rounded-lg border border-gray-700 bg-gray-800/40">
                        <button
                          onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left"
                        >
                          <div className="flex items-center gap-2">
                            {expandedId === card.id ? (
                              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                            )}
                            <span className="text-sm text-gray-200">{card.element_id}</span>
                            <span className="text-[10px] text-gray-500">v{card.version}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSyncCharacter(card.element_id) }}
                            disabled={syncingId === card.element_id}
                            className="px-2 py-1 rounded text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            {syncingId === card.element_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            同步
                          </button>
                        </button>
                        {expandedId === card.id && (
                          <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50 pt-3">
                            {/* Appearance */}
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1.5">外貌特征</p>
                              <div className="grid grid-cols-4 gap-2">
                                {Object.entries(card.appearance_tokens || {}).map(([k, v]) => (
                                  <div key={k} className="rounded bg-gray-900/60 px-2 py-1.5">
                                    <p className="text-[10px] text-gray-500">{k}</p>
                                    <p className="text-xs text-gray-300 truncate">{v}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* Costumes */}
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1.5">服装变体</p>
                              <div className="space-y-1.5">
                                {Object.entries(card.costume_tokens || {}).map(([variant, tokens]) => (
                                  <div key={variant} className="flex items-start gap-2">
                                    <span className="text-[10px] text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">{variant}</span>
                                    <p className="text-xs text-gray-300">{Array.isArray(tokens) ? tokens.join(', ') : String(tokens)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* Expressions */}
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1.5">表情库</p>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(card.expression_tokens || {}).map(([expr, prompt]) => (
                                  <span key={expr} className="text-[11px] px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-gray-300">
                                    {expr}: <span className="text-gray-400">{prompt}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            {/* Negative */}
                            {card.negative_prompts && (
                              <div>
                                <p className="text-[10px] text-gray-500 mb-1">负面提示词</p>
                                <p className="text-xs text-red-300/80">{card.negative_prompts}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Scenes Tab */}
              {activeTab === 'scenes' && (
                <div className="space-y-3">
                  {scenes.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">暂无场景档案，点击"一键同步"从共享元素导入</p>
                  ) : (
                    scenes.map((card) => (
                      <div key={card.id} className="rounded-lg border border-gray-700 bg-gray-800/40">
                        <button
                          onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left"
                        >
                          <div className="flex items-center gap-2">
                            {expandedId === card.id ? (
                              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                            )}
                            <span className="text-sm text-gray-200">{card.element_id}</span>
                            <span className="text-[10px] text-gray-500">v{card.version}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSyncScene(card.element_id) }}
                            disabled={syncingId === card.element_id}
                            className="px-2 py-1 rounded text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            {syncingId === card.element_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            同步
                          </button>
                        </button>
                        {expandedId === card.id && (
                          <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50 pt-3">
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1">基础提示词</p>
                              <p className="text-xs text-gray-300">{card.base_tokens}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1.5">时间变体</p>
                              <div className="grid grid-cols-2 gap-2">
                                {Object.entries(card.time_variants || {}).map(([time, prompt]) => (
                                  <div key={time} className="rounded bg-gray-900/60 px-2 py-1.5">
                                    <p className="text-[10px] text-purple-400">{time}</p>
                                    <p className="text-xs text-gray-300">{prompt}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {card.negative_prompts && (
                              <div>
                                <p className="text-[10px] text-gray-500 mb-1">负面提示词</p>
                                <p className="text-xs text-red-300/80">{card.negative_prompts}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Moods Tab */}
              {activeTab === 'moods' && (
                <div className="grid grid-cols-2 gap-3">
                  {moods.length === 0 ? (
                    <p className="col-span-2 text-xs text-gray-500 text-center py-8">暂无情绪氛围包</p>
                  ) : (
                    moods.map((pack) => {
                      const colorClass = MOOD_COLORS[pack.mood_key] || 'bg-gray-600/30 border-gray-500/50 text-gray-200'
                      const label = MOOD_LABELS[pack.mood_key] || pack.mood_key
                      return (
                        <div key={pack.mood_key} className={`rounded-lg border p-3 ${colorClass}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">{label}</span>
                            {pack.is_builtin && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10">内置</span>
                            )}
                          </div>
                          <div className="space-y-1 text-[11px] opacity-80">
                            {pack.color_tokens && <p>色彩: {pack.color_tokens}</p>}
                            {pack.line_style_tokens && <p>线条: {pack.line_style_tokens}</p>}
                            {pack.effect_tokens && <p>特效: {pack.effect_tokens}</p>}
                          </div>
                          {pack.combined_prompt && (
                            <div className="mt-2 pt-2 border-t border-white/10">
                              <p className="text-[10px] opacity-60 mb-0.5">合成提示词</p>
                              <p className="text-[11px] opacity-90 line-clamp-3">{pack.combined_prompt}</p>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* World Bible Tab */}
              {activeTab === 'world' && (
                <div className="space-y-4">
                  {!worldBible ? (
                    <p className="text-xs text-gray-500 text-center py-8">暂无世界观词典，点击"一键同步"初始化</p>
                  ) : (
                    <>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">美术风格</label>
                        <input
                          value={worldBible.art_style || ''}
                          onChange={(e) => setWorldBible({ ...worldBible, art_style: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="例如: 赛博朋克、水彩、吉卜力..."
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">时代背景</label>
                        <input
                          value={worldBible.era || ''}
                          onChange={(e) => setWorldBible({ ...worldBible, era: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="例如: 近未来2050、战国时代..."
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">色彩调性</label>
                        <textarea
                          rows={2}
                          value={worldBible.color_palette || ''}
                          onChange={(e) => setWorldBible({ ...worldBible, color_palette: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                          placeholder="warm tones, golden hour, desaturated blues..."
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">复现母题</label>
                        <textarea
                          rows={2}
                          value={worldBible.recurring_motifs || ''}
                          onChange={(e) => setWorldBible({ ...worldBible, recurring_motifs: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                          placeholder="反复出现的视觉符号、意象..."
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">禁止元素</label>
                        <textarea
                          rows={2}
                          value={worldBible.forbidden_elements || ''}
                          onChange={(e) => setWorldBible({ ...worldBible, forbidden_elements: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                          placeholder="不允许出现的内容..."
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={handleSaveWorldBible}
                          disabled={savingWorld}
                          className="px-4 py-1.5 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          {savingWorld ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          保存世界观
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
