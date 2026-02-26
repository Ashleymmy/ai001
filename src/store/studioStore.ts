import { create } from 'zustand'
import axios from 'axios'
import * as api from '../services/api'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioShot,
  StudioEpisodeElement,
} from '../services/api'

export type { StudioSeries, StudioEpisode, StudioElement, StudioShot, StudioEpisodeElement }

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

  // 操作状态
  creating: boolean
  planning: boolean
  generating: boolean

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
  creating: false,
  planning: false,
  generating: false,

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
      set({ currentEpisodeId: null, currentEpisode: null, shots: [] })
      return
    }
    set({ loading: true, error: null, errorCode: null, errorContext: null, currentEpisodeId: episodeId })
    try {
      const detail = await api.studioGetEpisode(episodeId)
      set({
        currentEpisode: detail,
        shots: detail.shots || [],
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
        set({ currentSeriesId: null, currentSeries: null, episodes: [], sharedElements: [], currentEpisodeId: null, currentEpisode: null, shots: [] })
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
    set({ generating: true, error: null, errorCode: null, errorContext: null })
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
    set({ generating: true, error: null, errorCode: null, errorContext: null })
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
    set({ generating: true, error: null, errorCode: null, errorContext: null })
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

  batchGenerate: async (episodeId, stages) => {
    set({ generating: true, error: null, errorCode: null, errorContext: null })
    try {
      await api.studioBatchGenerate(episodeId, stages)
      await get().selectEpisode(episodeId)
      set({ generating: false })
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ generating: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },
}))
