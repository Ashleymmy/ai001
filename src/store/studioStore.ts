import { create } from 'zustand'
import axios from 'axios'
import * as api from '../services/api'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioShot,
  StudioEpisodeElement,
  StudioBatchGenerateStreamEvent,
  StudioEpisodeHistoryEntry,
} from '../services/api'

export type { StudioSeries, StudioEpisode, StudioElement, StudioShot, StudioEpisodeElement }

export type StudioGenerationStage =
  | 'idle'
  | 'generating_elements'
  | 'generating_frames'
  | 'generating_end_frames'
  | 'generating_videos'
  | 'generating_audio'
  | 'complete'
  | 'error'

export interface StudioGenerationProgress {
  stage: StudioGenerationStage
  currentItem: string
  currentIndex: number
  totalItems: number
  percent: number
  errors: string[]
}

function createInitialGenerationProgress(): StudioGenerationProgress {
  return {
    stage: 'idle',
    currentItem: '',
    currentIndex: 0,
    totalItems: 0,
    percent: 0,
    errors: [],
  }
}

function mapBatchStage(stage: StudioBatchGenerateStreamEvent['stage']): StudioGenerationStage {
  if (stage === 'elements') return 'generating_elements'
  if (stage === 'frames') return 'generating_frames'
  if (stage === 'end_frames') return 'generating_end_frames'
  if (stage === 'videos') return 'generating_videos'
  if (stage === 'audio') return 'generating_audio'
  return 'idle'
}

function normalizeProgressNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, value)
}

let generationProgressResetTimer: ReturnType<typeof setTimeout> | null = null

type StudioErrorParsed = {
  message: string
  code: string | null
  context: Record<string, unknown> | null
}

function parseStudioError(e: unknown): StudioErrorParsed {
  if (axios.isAxiosError(e)) {
    if (!e.response) {
      if (e.code === 'ECONNABORTED') {
        return { message: '请求超时，请稍后重试', code: 'network_timeout', context: null }
      }
      return { message: '网络连接失败，请检查后端服务是否运行', code: 'network_error', context: null }
    }

    const detail = (e.response.data as { detail?: unknown } | undefined)?.detail
    if (typeof detail === 'string') {
      return { message: detail, code: null, context: null }
    }

    if (detail && typeof detail === 'object') {
      const data = detail as { detail?: string; error_code?: string; context?: Record<string, unknown> }
      return {
        message: data.detail || '操作失败',
        code: data.error_code || null,
        context: data.context || null,
      }
    }

    return { message: e.message || '请求失败', code: null, context: null }
  }

  if (e instanceof Error) {
    return { message: e.message || '操作失败', code: null, context: null }
  }

  return { message: '发生未知错误', code: null, context: null }
}

interface StudioState {
  // 列表
  seriesList: StudioSeries[]
  loading: boolean
  error: string | null
  errorCode: string | null
  errorContext: Record<string, unknown> | null

  // 当前选中
  currentSeriesId: string | null
  currentEpisodeId: string | null

  // 当前系列详情
  currentSeries: StudioSeries | null
  episodes: StudioEpisode[]
  sharedElements: StudioElement[]

  // 当前集详情
  currentEpisode: StudioEpisode | null
  shots: StudioShot[]
  episodeHistory: StudioEpisodeHistoryEntry[]
  historyLoading: boolean
  historyRestoring: boolean

  // 操作状态
  creating: boolean
  planning: boolean
  generating: boolean
  generationProgress: StudioGenerationProgress

  // Actions
  loadSeriesList: () => Promise<void>
  selectSeries: (seriesId: string | null) => Promise<void>
  selectEpisode: (episodeId: string | null) => Promise<void>

  createSeries: (params: {
    name: string
    script: string
    description?: string
    series_bible?: string
    visual_style?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => Promise<StudioSeries | null>

  updateSeries: (seriesId: string, updates: Record<string, unknown>) => Promise<void>
  deleteSeries: (seriesId: string) => Promise<void>

  updateEpisode: (episodeId: string, updates: Record<string, unknown>) => Promise<void>
  planEpisode: (episodeId: string) => Promise<void>
  enhanceEpisode: (episodeId: string, mode?: 'refine' | 'expand') => Promise<void>

  addElement: (seriesId: string, element: { name: string; type: string; description?: string; voice_profile?: string; is_favorite?: number }) => Promise<void>
  updateElement: (elementId: string, updates: Record<string, unknown>) => Promise<void>
  deleteElement: (elementId: string) => Promise<void>
  generateElementImage: (elementId: string) => Promise<void>

  updateShot: (shotId: string, updates: Record<string, unknown>) => Promise<void>
  deleteShot: (shotId: string) => Promise<void>
  generateShotAsset: (shotId: string, stage: 'frame' | 'end_frame' | 'video' | 'audio') => Promise<void>
  inpaintShotFrame: (shotId: string, params: { edit_prompt: string; mask_data?: string; width?: number; height?: number }) => Promise<void>
  reorderShots: (episodeId: string, shotIds: string[]) => Promise<void>
  loadEpisodeHistory: (episodeId: string, limit?: number, includeSnapshot?: boolean) => Promise<void>
  restoreEpisodeHistory: (episodeId: string, historyId: string) => Promise<void>

  batchGenerate: (episodeId: string, stages?: string[]) => Promise<void>

  clearError: () => void
}

export const useStudioStore = create<StudioState>((set, get) => ({
  seriesList: [],
  loading: false,
  error: null,
  errorCode: null,
  errorContext: null,
  currentSeriesId: null,
  currentEpisodeId: null,
  currentSeries: null,
  episodes: [],
  sharedElements: [],
  currentEpisode: null,
  shots: [],
  episodeHistory: [],
  historyLoading: false,
  historyRestoring: false,
  creating: false,
  planning: false,
  generating: false,
  generationProgress: createInitialGenerationProgress(),

  clearError: () => set({ error: null, errorCode: null, errorContext: null }),

  loadSeriesList: async () => {
    set({ loading: true, error: null, errorCode: null, errorContext: null })
    try {
      const list = await api.studioListSeries()
      set({ seriesList: list, loading: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ loading: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  selectSeries: async (seriesId) => {
    if (!seriesId) {
      set({
        currentSeriesId: null,
        currentSeries: null,
        episodes: [],
        sharedElements: [],
        currentEpisodeId: null,
        currentEpisode: null,
        shots: [],
        episodeHistory: [],
        historyLoading: false,
        historyRestoring: false,
      })
      return
    }
    set({
      loading: true,
      error: null,
      errorCode: null,
      errorContext: null,
      currentSeriesId: seriesId,
      currentEpisodeId: null,
      currentEpisode: null,
      shots: [],
      episodeHistory: [],
      historyLoading: false,
      historyRestoring: false,
    })
    try {
      const detail = await api.studioGetSeries(seriesId)
      set({
        currentSeries: detail,
        episodes: detail.episodes || [],
        sharedElements: detail.shared_elements || [],
        loading: false,
      })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ loading: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  selectEpisode: async (episodeId) => {
    if (!episodeId) {
      set({ currentEpisodeId: null, currentEpisode: null, shots: [], episodeHistory: [], historyLoading: false, historyRestoring: false })
      return
    }
    set({ loading: true, error: null, errorCode: null, errorContext: null, currentEpisodeId: episodeId })
    try {
      const detail = await api.studioGetEpisode(episodeId)
      set({
        currentEpisode: detail,
        shots: detail.shots || [],
        episodeHistory: [],
        historyLoading: false,
        historyRestoring: false,
        loading: false,
      })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ loading: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  createSeries: async (params) => {
    set({ creating: true, error: null, errorCode: null, errorContext: null })
    try {
      const result = await api.studioCreateSeries(params)
      // 刷新列表
      const list = await api.studioListSeries()
      set({
        seriesList: list,
        creating: false,
        currentSeriesId: result.series.id,
        currentSeries: result.series,
        episodes: result.episodes,
        sharedElements: result.shared_elements,
      })
      return result.series
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ creating: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
      return null
    }
  },

  updateSeries: async (seriesId, updates) => {
    try {
      await api.studioUpdateSeries(seriesId, updates)
      // 刷新
      if (get().currentSeriesId === seriesId) {
        await get().selectSeries(seriesId)
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  deleteSeries: async (seriesId) => {
    try {
      await api.studioDeleteSeries(seriesId)
      if (get().currentSeriesId === seriesId) {
        set({
          currentSeriesId: null,
          currentSeries: null,
          episodes: [],
          sharedElements: [],
          currentEpisodeId: null,
          currentEpisode: null,
          shots: [],
          episodeHistory: [],
          historyLoading: false,
          historyRestoring: false,
        })
      }
      await get().loadSeriesList()
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  updateEpisode: async (episodeId, updates) => {
    try {
      await api.studioUpdateEpisode(episodeId, updates)
      if (get().currentEpisodeId === episodeId) {
        await get().selectEpisode(episodeId)
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  planEpisode: async (episodeId) => {
    set({ planning: true, error: null, errorCode: null, errorContext: null })
    try {
      await api.studioPlanEpisode(episodeId)
      // 刷新集详情
      await get().selectEpisode(episodeId)
      // 刷新系列的集列表（状态可能变化）
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const eps = await api.studioListEpisodes(seriesId)
        set({ episodes: eps })
      }
      set({ planning: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ planning: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  enhanceEpisode: async (episodeId, mode = 'refine') => {
    set({ planning: true, error: null, errorCode: null, errorContext: null })
    try {
      await api.studioEnhanceEpisode(episodeId, mode)
      await get().selectEpisode(episodeId)
      set({ planning: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ planning: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  addElement: async (seriesId, element) => {
    try {
      await api.studioAddElement(seriesId, element)
      const els = await api.studioGetElements(seriesId)
      set({ sharedElements: els })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  updateElement: async (elementId, updates) => {
    try {
      await api.studioUpdateElement(elementId, updates)
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  deleteElement: async (elementId) => {
    try {
      await api.studioDeleteElement(elementId)
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  generateElementImage: async (elementId) => {
    set({ generating: true, error: null, errorCode: null, errorContext: null, generationProgress: createInitialGenerationProgress() })
    try {
      await api.studioGenerateElementImage(elementId)
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
      set({ generating: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ generating: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  updateShot: async (shotId, updates) => {
    try {
      await api.studioUpdateShot(shotId, updates)
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  deleteShot: async (shotId) => {
    try {
      await api.studioDeleteShot(shotId)
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  generateShotAsset: async (shotId, stage) => {
    set({ generating: true, error: null, errorCode: null, errorContext: null, generationProgress: createInitialGenerationProgress() })
    try {
      await api.studioGenerateShotAsset(shotId, { stage })
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
      set({ generating: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ generating: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  inpaintShotFrame: async (shotId, params) => {
    set({ generating: true, error: null, errorCode: null, errorContext: null, generationProgress: createInitialGenerationProgress() })
    try {
      await api.studioInpaintShotFrame(shotId, params)
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
      set({ generating: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ generating: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  reorderShots: async (episodeId, shotIds) => {
    try {
      const shots = await api.studioReorderShots(episodeId, shotIds)
      if (get().currentEpisodeId === episodeId) {
        set({ shots })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  loadEpisodeHistory: async (episodeId, limit = 50, includeSnapshot = false) => {
    set({ historyLoading: true })
    try {
      const history = await api.studioGetEpisodeHistory(episodeId, limit, includeSnapshot)
      if (get().currentEpisodeId === episodeId) {
        set({ episodeHistory: history, historyLoading: false })
      } else {
        set({ historyLoading: false })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ historyLoading: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  restoreEpisodeHistory: async (episodeId, historyId) => {
    set({ historyRestoring: true, error: null, errorCode: null, errorContext: null })
    try {
      const result = await api.studioRestoreEpisodeHistory(episodeId, historyId)
      const restoredEpisode = result.episode
      if (get().currentEpisodeId === episodeId) {
        set({
          currentEpisode: restoredEpisode,
          shots: restoredEpisode.shots || [],
          episodeHistory: result.history || [],
          historyRestoring: false,
        })
      } else {
        set({ historyRestoring: false })
      }
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const eps = await api.studioListEpisodes(seriesId)
        set({ episodes: eps })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ historyRestoring: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  batchGenerate: async (episodeId, stages) => {
    if (generationProgressResetTimer) {
      clearTimeout(generationProgressResetTimer)
      generationProgressResetTimer = null
    }
    set({
      generating: true,
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })

    const runFallbackBatch = async () => {
      await api.studioBatchGenerate(episodeId, stages)
      set((state) => ({
        generationProgress: {
          ...state.generationProgress,
          stage: 'complete',
          currentItem: '批量生成完成（兼容模式）',
          currentIndex: state.generationProgress.totalItems,
          percent: 100,
        },
      }))
    }

    try {
      const runStreamBatch = async () => {
        await new Promise<void>((resolve, reject) => {
          let finished = false
          let hasProgressEvent = false
          let closeStream: (() => void) | null = null

          const safeClose = () => {
            if (!closeStream) return
            closeStream()
            closeStream = null
          }

          const resolveOnce = () => {
            if (finished) return
            finished = true
            safeClose()
            resolve()
          }

          const rejectOnce = (err: Error, isTransport: boolean = false) => {
            if (finished) return
            finished = true
            safeClose()
            const tagged = err as Error & { isStreamTransportError?: boolean; hasProgressEvent?: boolean }
            tagged.isStreamTransportError = isTransport
            tagged.hasProgressEvent = hasProgressEvent
            reject(tagged)
          }

          closeStream = api.studioBatchGenerateStream(
            episodeId,
            stages,
            (event) => {
              hasProgressEvent = true

              if (event.type === 'start') {
                set((state) => {
                  const total = normalizeProgressNumber(event.total, state.generationProgress.totalItems)
                  return {
                    generationProgress: {
                      ...state.generationProgress,
                      currentIndex: 0,
                      totalItems: total,
                      percent: 0,
                    },
                  }
                })
                return
              }

              if (event.type === 'stage_start') {
                set((state) => ({
                  generationProgress: {
                    ...state.generationProgress,
                    stage: mapBatchStage(event.stage),
                    currentItem: '',
                    totalItems: normalizeProgressNumber(event.total, state.generationProgress.totalItems),
                  },
                }))
                return
              }

              if (event.type === 'item_start') {
                set((state) => ({
                  generationProgress: {
                    ...state.generationProgress,
                    stage: mapBatchStage(event.stage),
                    currentItem: event.item_name || state.generationProgress.currentItem,
                    currentIndex: Math.min(
                      normalizeProgressNumber(event.total, state.generationProgress.totalItems) || Number.MAX_SAFE_INTEGER,
                      Math.max(
                        state.generationProgress.currentIndex,
                        normalizeProgressNumber(event.processed, state.generationProgress.currentIndex) + 1
                      )
                    ),
                    totalItems: normalizeProgressNumber(event.total, state.generationProgress.totalItems),
                    percent: Math.min(100, normalizeProgressNumber(event.percent, state.generationProgress.percent)),
                  },
                }))
                return
              }

              if (event.type === 'item_complete') {
                set((state) => {
                  const errorList = [...state.generationProgress.errors]
                  if (event.ok === false && event.error) {
                    errorList.push(`${event.item_name || '未命名项'}: ${event.error}`)
                  }
                  return {
                    generationProgress: {
                      ...state.generationProgress,
                      stage: mapBatchStage(event.stage),
                      currentItem: event.item_name || state.generationProgress.currentItem,
                      currentIndex: normalizeProgressNumber(event.processed, state.generationProgress.currentIndex),
                      totalItems: normalizeProgressNumber(event.total, state.generationProgress.totalItems),
                      percent: Math.min(100, normalizeProgressNumber(event.percent, state.generationProgress.percent)),
                      errors: errorList,
                    },
                  }
                })
                return
              }

              if (event.type === 'done') {
                set((state) => {
                  const total = normalizeProgressNumber(event.total, state.generationProgress.totalItems)
                  const current = normalizeProgressNumber(event.processed, total || state.generationProgress.currentIndex)
                  const failed = normalizeProgressNumber(event.failed, state.generationProgress.errors.length)
                  return {
                    generationProgress: {
                      ...state.generationProgress,
                      stage: 'complete',
                      currentItem: failed > 0 ? `已完成，失败 ${failed} 项` : '全部资产生成完成',
                      currentIndex: total > 0 ? total : current,
                      totalItems: total,
                      percent: 100,
                    },
                  }
                })
                resolveOnce()
                return
              }

              if (event.type === 'error') {
                const message = event.detail || event.error || '批量生成失败'
                set((state) => ({
                  generationProgress: {
                    ...state.generationProgress,
                    stage: 'error',
                    currentItem: message,
                    errors: [...state.generationProgress.errors, message],
                  },
                }))
                rejectOnce(new Error(message))
              }
            },
            (streamError) => {
              rejectOnce(streamError, true)
            },
          )
        })
      }

      if (typeof EventSource === 'undefined') {
        await runFallbackBatch()
      } else {
        try {
          await runStreamBatch()
        } catch (e: unknown) {
          const streamError = e as Error & { isStreamTransportError?: boolean; hasProgressEvent?: boolean }
          if (streamError.isStreamTransportError && !streamError.hasProgressEvent) {
            await runFallbackBatch()
          } else {
            throw e
          }
        }
      }

      await get().selectEpisode(episodeId)
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const eps = await api.studioListEpisodes(seriesId)
        set({ episodes: eps })
      }
      set({ generating: false })

      generationProgressResetTimer = setTimeout(() => {
        if (!get().generating) {
          set({ generationProgress: createInitialGenerationProgress() })
        }
        generationProgressResetTimer = null
      }, 2600)
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set((state) => ({
        generating: false,
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
        generationProgress: state.generationProgress.stage === 'error'
          ? state.generationProgress
          : {
              ...state.generationProgress,
              stage: 'error',
              currentItem: parsed.message,
              errors: [...state.generationProgress.errors, parsed.message],
            },
      }))
    }
  },
}))
