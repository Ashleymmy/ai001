import { create } from 'zustand'
import * as api from '../services/api'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioShot,
} from '../services/api'

export type { StudioSeries, StudioEpisode, StudioElement, StudioShot }

interface StudioState {
  // 列表
  seriesList: StudioSeries[]
  loading: boolean
  error: string | null

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

  addElement: (seriesId: string, element: { name: string; type: string; description?: string; voice_profile?: string }) => Promise<void>
  updateElement: (elementId: string, updates: Record<string, unknown>) => Promise<void>
  deleteElement: (elementId: string) => Promise<void>
  generateElementImage: (elementId: string) => Promise<void>

  updateShot: (shotId: string, updates: Record<string, unknown>) => Promise<void>
  deleteShot: (shotId: string) => Promise<void>
  generateShotAsset: (shotId: string, stage: 'frame' | 'video' | 'audio') => Promise<void>

  batchGenerate: (episodeId: string, stages?: string[]) => Promise<void>

  clearError: () => void
}

export const useStudioStore = create<StudioState>((set, get) => ({
  seriesList: [],
  loading: false,
  error: null,
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

  clearError: () => set({ error: null }),

  loadSeriesList: async () => {
    set({ loading: true, error: null })
    try {
      const list = await api.studioListSeries()
      set({ seriesList: list, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message })
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
    set({ loading: true, error: null, currentSeriesId: seriesId, currentEpisodeId: null, currentEpisode: null, shots: [] })
    try {
      const detail = await api.studioGetSeries(seriesId)
      set({
        currentSeries: detail,
        episodes: detail.episodes || [],
        sharedElements: detail.shared_elements || [],
        loading: false,
      })
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  selectEpisode: async (episodeId) => {
    if (!episodeId) {
      set({ currentEpisodeId: null, currentEpisode: null, shots: [] })
      return
    }
    set({ loading: true, error: null, currentEpisodeId: episodeId })
    try {
      const detail = await api.studioGetEpisode(episodeId)
      set({
        currentEpisode: detail,
        shots: detail.shots || [],
        loading: false,
      })
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  createSeries: async (params) => {
    set({ creating: true, error: null })
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
      set({ creating: false, error: (e as Error).message })
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
      set({ error: (e as Error).message })
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
      set({ error: (e as Error).message })
    }
  },

  updateEpisode: async (episodeId, updates) => {
    try {
      await api.studioUpdateEpisode(episodeId, updates)
      if (get().currentEpisodeId === episodeId) {
        await get().selectEpisode(episodeId)
      }
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  planEpisode: async (episodeId) => {
    set({ planning: true, error: null })
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
      set({ planning: false, error: (e as Error).message })
    }
  },

  enhanceEpisode: async (episodeId, mode = 'refine') => {
    set({ planning: true, error: null })
    try {
      await api.studioEnhanceEpisode(episodeId, mode)
      await get().selectEpisode(episodeId)
      set({ planning: false })
    } catch (e: unknown) {
      set({ planning: false, error: (e as Error).message })
    }
  },

  addElement: async (seriesId, element) => {
    try {
      await api.studioAddElement(seriesId, element)
      const els = await api.studioGetElements(seriesId)
      set({ sharedElements: els })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
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
      set({ error: (e as Error).message })
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
      set({ error: (e as Error).message })
    }
  },

  generateElementImage: async (elementId) => {
    set({ generating: true, error: null })
    try {
      await api.studioGenerateElementImage(elementId)
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
      set({ generating: false })
    } catch (e: unknown) {
      set({ generating: false, error: (e as Error).message })
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
      set({ error: (e as Error).message })
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
      set({ error: (e as Error).message })
    }
  },

  generateShotAsset: async (shotId, stage) => {
    set({ generating: true, error: null })
    try {
      await api.studioGenerateShotAsset(shotId, { stage })
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
      set({ generating: false })
    } catch (e: unknown) {
      set({ generating: false, error: (e as Error).message })
    }
  },

  batchGenerate: async (episodeId, stages) => {
    set({ generating: true, error: null })
    try {
      await api.studioBatchGenerate(episodeId, stages)
      await get().selectEpisode(episodeId)
      set({ generating: false })
    } catch (e: unknown) {
      set({ generating: false, error: (e as Error).message })
    }
  },
}))
