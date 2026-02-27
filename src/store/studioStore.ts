/**
 * 功能模块：状态管理模块，负责 studioStore 相关业务状态与动作编排
 */

import { create } from 'zustand'
import axios from 'axios'
import * as api from '../services/api'
import {
  enqueueImageGeneration,
  enqueueVideoGeneration,
  getGenerationQueueParallelConfig,
} from './generationQueueStore'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioShot,
  StudioEpisodeElement,
  StudioCharacterDocImportResult,
  StudioCharacterSplitResult,
  StudioBatchGenerateStreamEvent,
  StudioEpisodeHistoryEntry,
} from '../services/api'

export type { StudioSeries, StudioEpisode, StudioElement, StudioShot, StudioEpisodeElement }

export type StudioGenerationStage =
  | 'idle'
  | 'generating_elements'
  | 'generating_frames'
  | 'generating_key_frames'
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

export type StudioGenerationScope = 'none' | 'single' | 'batch'

export type StudioFailedOperationStatus = 'failed' | 'retrying' | 'resolved'

export interface StudioFailedOperation {
  id: string
  key: string
  title: string
  message: string
  code: string | null
  context: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  retryCount: number
  status: StudioFailedOperationStatus
  retryable: boolean
}

export interface StudioRetryRecord {
  id: string
  operationId: string
  operationTitle: string
  attempt: number
  startedAt: string
  finishedAt: string
  success: boolean
  message: string
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
  if (stage === 'key_frames') return 'generating_key_frames'
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
let loadSeriesRequestSeq = 0
let selectSeriesRequestSeq = 0
let selectEpisodeRequestSeq = 0
let loadHistoryRequestSeq = 0
const failedOperationRetryTaskMap = new Map<string, () => Promise<void>>()
const FAILED_OPERATION_LIMIT = 20
const RETRY_RECORD_LIMIT = 60

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

function shouldRetryStudioError(parsed: StudioErrorParsed): boolean {
  return parsed.code === 'network_error' || parsed.code === 'network_timeout'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withTransientRetry<T>(
  task: () => Promise<T>,
  maxAttempts: number = 2,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await task()
    } catch (e: unknown) {
      lastError = e
      const parsed = parseStudioError(e)
      if (!shouldRetryStudioError(parsed) || attempt >= maxAttempts - 1) {
        throw e
      }
      await sleep(260 * (attempt + 1))
    }
  }
  throw lastError
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

  // 协作 Episode 分配
  episodeAssignments: api.EpisodeAssignment[]
  episodeAssignmentsLoading: boolean

  // 操作日志（撤销历史可视化）
  operationJournal: api.OperationJournalItem[]
  operationJournalHeadIndex: number
  operationJournalTotal: number
  operationJournalLoading: boolean

  // 在线成员（WebSocket）
  onlineMembers: api.OnlineMember[]

  // 操作状态
  creating: boolean
  planning: boolean
  generating: boolean
  generationScope: StudioGenerationScope
  generationMessage: string
  generationProgress: StudioGenerationProgress
  failedOperations: StudioFailedOperation[]
  retryHistory: StudioRetryRecord[]

  // Actions
  loadSeriesList: () => Promise<void>
  selectSeries: (seriesId: string | null) => Promise<void>
  selectEpisode: (episodeId: string | null) => Promise<void>

  createSeries: (params: {
    name: string
    script: string
    workspace_id?: string
    workbench_mode?: 'longform' | 'short_video' | 'digital_human'
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
  importCharacterDocument: (
    seriesId: string,
    documentText: string,
    options?: { saveToElements?: boolean; dedupeByName?: boolean }
  ) => Promise<StudioCharacterDocImportResult | null>
  splitCharacterByAge: (
    elementId: string,
    options?: { replaceOriginal?: boolean }
  ) => Promise<StudioCharacterSplitResult | null>
  generateElementImage: (
    elementId: string,
    options?: { useReference?: boolean; referenceMode?: 'none' | 'light' | 'full'; width?: number; height?: number }
  ) => Promise<void>

  updateShot: (shotId: string, updates: Record<string, unknown>) => Promise<void>
  deleteShot: (shotId: string) => Promise<void>
  generateShotAsset: (
    shotId: string,
    stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio',
    options?: { video_generate_audio?: boolean }
  ) => Promise<void>
  inpaintShotFrame: (shotId: string, params: { edit_prompt: string; mask_data?: string; width?: number; height?: number }) => Promise<void>
  reorderShots: (episodeId: string, shotIds: string[]) => Promise<void>
  loadEpisodeHistory: (episodeId: string, limit?: number, includeSnapshot?: boolean) => Promise<void>
  restoreEpisodeHistory: (episodeId: string, historyId: string) => Promise<void>
  undoWorkspaceOperation: (workspaceId: string, projectScope: string) => Promise<void>
  redoWorkspaceOperation: (workspaceId: string, projectScope: string) => Promise<void>
  loadOperationJournal: (workspaceId: string, projectScope: string, limit?: number) => Promise<void>
  setOnlineMembers: (members: api.OnlineMember[]) => void

  loadEpisodeAssignments: (workspaceId: string, seriesId?: string) => Promise<void>
  assignEpisode: (workspaceId: string, episodeId: string, assignedTo: string, note?: string) => Promise<void>
  submitEpisodeForReview: (workspaceId: string, episodeId: string) => Promise<void>
  reviewEpisodeAssignment: (workspaceId: string, episodeId: string, action: 'approve' | 'reject', note?: string) => Promise<void>

  batchGenerate: (
    episodeId: string,
    stages?: string[],
    options?: { video_generate_audio?: boolean }
  ) => Promise<void>
  retryFailedOperation: (operationId: string) => Promise<void>
  dismissFailedOperation: (operationId: string) => void
  clearResolvedFailedOperations: () => void
  clearRetryHistory: () => void

  clearError: () => void
}

type StudioStateSetter = (partial: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void

interface FailedOperationPayload {
  key: string
  title: string
  message: string
  code: string | null
  context: Record<string, unknown> | null
  retryTask?: () => Promise<void>
}

function createStudioStoreId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function appendRetryRecord(
  set: StudioStateSetter,
  record: Omit<StudioRetryRecord, 'id'>,
): void {
  set((state) => ({
    retryHistory: [
      { id: createStudioStoreId('retry'), ...record },
      ...state.retryHistory,
    ].slice(0, RETRY_RECORD_LIMIT),
  }))
}

function upsertFailedOperation(
  set: StudioStateSetter,
  payload: FailedOperationPayload,
): string {
  const now = new Date().toISOString()
  let operationId = ''
  let removedIds: string[] = []

  set((state) => {
    const existing = state.failedOperations.find((item) => item.key === payload.key && item.status !== 'resolved')
    if (existing) {
      operationId = existing.id
      return {
        failedOperations: state.failedOperations.map((item) => (
          item.id === existing.id
            ? {
                ...item,
                title: payload.title,
                message: payload.message,
                code: payload.code,
                context: payload.context,
                updatedAt: now,
                status: 'failed',
                retryable: payload.retryTask ? true : item.retryable,
              }
            : item
        )),
      }
    }

    operationId = createStudioStoreId('failed')
    const entry: StudioFailedOperation = {
      id: operationId,
      key: payload.key,
      title: payload.title,
      message: payload.message,
      code: payload.code,
      context: payload.context,
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      status: 'failed',
      retryable: Boolean(payload.retryTask),
    }
    const nextOperations = [entry, ...state.failedOperations]
    if (nextOperations.length > FAILED_OPERATION_LIMIT) {
      removedIds = nextOperations.slice(FAILED_OPERATION_LIMIT).map((item) => item.id)
    }
    return {
      failedOperations: nextOperations.slice(0, FAILED_OPERATION_LIMIT),
    }
  })

  if (payload.retryTask) {
    failedOperationRetryTaskMap.set(operationId, payload.retryTask)
  }
  if (removedIds.length > 0) {
    removedIds.forEach((id) => failedOperationRetryTaskMap.delete(id))
  }
  return operationId
}

function queueOperationFailure(
  set: StudioStateSetter,
  e: unknown,
  payload: Omit<FailedOperationPayload, 'message' | 'code' | 'context'>,
): StudioErrorParsed {
  const parsed = parseStudioError(e)
  upsertFailedOperation(set, {
    ...payload,
    message: parsed.message,
    code: parsed.code,
    context: parsed.context,
  })
  return parsed
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
  episodeAssignments: [],
  episodeAssignmentsLoading: false,
  operationJournal: [],
  operationJournalHeadIndex: 0,
  operationJournalTotal: 0,
  operationJournalLoading: false,
  onlineMembers: [],
  creating: false,
  planning: false,
  generating: false,
  generationScope: 'none',
  generationMessage: '',
  generationProgress: createInitialGenerationProgress(),
  failedOperations: [],
  retryHistory: [],

  retryFailedOperation: async (operationId) => {
    const operation = get().failedOperations.find((item) => item.id === operationId)
    if (!operation || operation.status === 'retrying') return
    const retryTask = failedOperationRetryTaskMap.get(operationId)
    if (!retryTask) {
      const now = new Date().toISOString()
      appendRetryRecord(set, {
        operationId,
        operationTitle: operation.title,
        attempt: operation.retryCount + 1,
        startedAt: now,
        finishedAt: now,
        success: false,
        message: '当前操作不支持重试',
      })
      set((state) => ({
        failedOperations: state.failedOperations.map((item) => (
          item.id === operationId
            ? {
                ...item,
                status: 'failed',
                message: '当前操作不支持重试',
                updatedAt: now,
                retryable: false,
              }
            : item
        )),
      }))
      return
    }

    const startedAt = new Date().toISOString()
    const attempt = operation.retryCount + 1
    set((state) => ({
      failedOperations: state.failedOperations.map((item) => (
        item.id === operationId
          ? {
              ...item,
              status: 'retrying',
              retryCount: attempt,
              updatedAt: startedAt,
            }
          : item
      )),
    }))

    try {
      await retryTask()
      const finishedAt = new Date().toISOString()
      const latest = get().failedOperations.find((item) => item.id === operationId)
      if (!latest) return
      if (latest.status === 'retrying') {
        set((state) => ({
          failedOperations: state.failedOperations.map((item) => (
            item.id === operationId
              ? {
                  ...item,
                  status: 'resolved',
                  message: '重试成功，已恢复',
                  updatedAt: finishedAt,
                }
              : item
          )),
        }))
        failedOperationRetryTaskMap.delete(operationId)
        appendRetryRecord(set, {
          operationId,
          operationTitle: latest.title,
          attempt,
          startedAt,
          finishedAt,
          success: true,
          message: '重试成功',
        })
      } else {
        appendRetryRecord(set, {
          operationId,
          operationTitle: latest.title,
          attempt,
          startedAt,
          finishedAt,
          success: false,
          message: latest.message || '重试失败',
        })
      }
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      const finishedAt = new Date().toISOString()
      set((state) => ({
        failedOperations: state.failedOperations.map((item) => (
          item.id === operationId
            ? {
                ...item,
                status: 'failed',
                message: parsed.message,
                code: parsed.code,
                context: parsed.context,
                updatedAt: finishedAt,
              }
            : item
        )),
      }))
      appendRetryRecord(set, {
        operationId,
        operationTitle: operation.title,
        attempt,
        startedAt,
        finishedAt,
        success: false,
        message: parsed.message,
      })
    }
  },

  dismissFailedOperation: (operationId) => {
    failedOperationRetryTaskMap.delete(operationId)
    set((state) => ({
      failedOperations: state.failedOperations.filter((item) => item.id !== operationId),
    }))
  },

  clearResolvedFailedOperations: () => {
    const resolvedIds = get().failedOperations.filter((item) => item.status === 'resolved').map((item) => item.id)
    resolvedIds.forEach((id) => failedOperationRetryTaskMap.delete(id))
    set((state) => ({
      failedOperations: state.failedOperations.filter((item) => item.status !== 'resolved'),
    }))
  },

  clearRetryHistory: () => {
    set({ retryHistory: [] })
  },

  clearError: () => set({ error: null, errorCode: null, errorContext: null }),

  loadSeriesList: async () => {
    const requestSeq = ++loadSeriesRequestSeq
    set({ loading: true, error: null, errorCode: null, errorContext: null })
    try {
      const list = await withTransientRetry(() => api.studioListSeries(), 2)
      if (requestSeq !== loadSeriesRequestSeq) return
      const currentSeriesId = get().currentSeriesId
      const keepCurrent = !!currentSeriesId && list.some((item) => item.id === currentSeriesId)
      if (keepCurrent) {
        set({ seriesList: list, loading: false })
      } else {
        set({
          seriesList: list,
          loading: false,
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
    } catch (e: unknown) {
      if (requestSeq !== loadSeriesRequestSeq) return
      const parsed = queueOperationFailure(set, e, {
        key: 'load_series_list',
        title: '加载系列列表',
        retryTask: () => get().loadSeriesList(),
      })
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
    const requestSeq = ++selectSeriesRequestSeq
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
      const detail = await withTransientRetry(() => api.studioGetSeries(seriesId), 2)
      if (requestSeq !== selectSeriesRequestSeq) return
      set({
        currentSeries: detail,
        episodes: detail.episodes || [],
        sharedElements: detail.shared_elements || [],
        loading: false,
      })
    } catch (e: unknown) {
      if (requestSeq !== selectSeriesRequestSeq) return
      const parsed = queueOperationFailure(set, e, {
        key: `select_series:${seriesId}`,
        title: '加载系列详情',
        retryTask: () => get().selectSeries(seriesId),
      })
      set({ loading: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  selectEpisode: async (episodeId) => {
    if (!episodeId) {
      set({ currentEpisodeId: null, currentEpisode: null, shots: [], episodeHistory: [], historyLoading: false, historyRestoring: false })
      return
    }
    const requestSeq = ++selectEpisodeRequestSeq
    set({ loading: true, error: null, errorCode: null, errorContext: null, currentEpisodeId: episodeId })
    try {
      const detail = await withTransientRetry(() => api.studioGetEpisode(episodeId), 2)
      if (requestSeq !== selectEpisodeRequestSeq) return
      set({
        currentEpisode: detail,
        shots: detail.shots || [],
        episodeHistory: [],
        historyLoading: false,
        historyRestoring: false,
        loading: false,
      })
    } catch (e: unknown) {
      if (requestSeq !== selectEpisodeRequestSeq) return
      const parsed = queueOperationFailure(set, e, {
        key: `select_episode:${episodeId}`,
        title: '加载单集详情',
        retryTask: () => get().selectEpisode(episodeId),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: 'create_series',
        title: '创建系列',
        retryTask: () => get().createSeries(params).then(() => undefined),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `update_series:${seriesId}`,
        title: '更新系列信息',
        retryTask: () => get().updateSeries(seriesId, updates),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `delete_series:${seriesId}`,
        title: '删除系列',
        retryTask: () => get().deleteSeries(seriesId),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `update_episode:${episodeId}`,
        title: '更新分幕信息',
        retryTask: () => get().updateEpisode(episodeId, updates),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `plan_episode:${episodeId}`,
        title: '分镜规划',
        retryTask: () => get().planEpisode(episodeId),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `enhance_episode:${episodeId}:${mode}`,
        title: mode === 'expand' ? '镜头扩展' : '镜头优化',
        retryTask: () => get().enhanceEpisode(episodeId, mode),
      })
      set({ planning: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  addElement: async (seriesId, element) => {
    try {
      await api.studioAddElement(seriesId, element)
      const els = await api.studioGetElements(seriesId)
      set({ sharedElements: els })
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `add_element:${seriesId}:${element.name}`,
        title: '新增共享元素',
        retryTask: () => get().addElement(seriesId, element),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `update_element:${elementId}`,
        title: '更新共享元素',
        retryTask: () => get().updateElement(elementId, updates),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `delete_element:${elementId}`,
        title: '删除共享元素',
        retryTask: () => get().deleteElement(elementId),
      })
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  importCharacterDocument: async (seriesId, documentText, options) => {
    set({
      generating: true,
      generationScope: 'single',
      generationMessage: '正在拆分角色文档',
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    try {
      const result = await api.studioImportCharacterDoc(seriesId, {
        document_text: documentText,
        save_to_elements: options?.saveToElements ?? true,
        dedupe_by_name: options?.dedupeByName ?? true,
      })
      const activeSeriesId = get().currentSeriesId
      if (activeSeriesId === seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
      set({ generating: false, generationScope: 'none', generationMessage: '' })
      return result
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `import_character_doc:${seriesId}`,
        title: '导入角色文档',
        retryTask: () => get().importCharacterDocument(seriesId, documentText, options),
      })
      set({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
      })
      return null
    }
  },

  splitCharacterByAge: async (elementId, options) => {
    set({
      generating: true,
      generationScope: 'single',
      generationMessage: '正在按阶段拆分角色',
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    try {
      const result = await api.studioSplitCharacterByAge(elementId, {
        replace_original: options?.replaceOriginal ?? false,
      })
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
      const episodeId = get().currentEpisodeId
      if (episodeId) {
        const shots = await api.studioGetShots(episodeId)
        set({ shots })
      }
      set({ generating: false, generationScope: 'none', generationMessage: '' })
      return result
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `split_character_by_age:${elementId}`,
        title: '角色阶段拆分',
        retryTask: () => get().splitCharacterByAge(elementId, options),
      })
      set({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
      })
      return null
    }
  },

  generateElementImage: async (elementId, options) => {
    set({
      generating: true,
      generationScope: 'single',
      generationMessage: '正在生成素材参考图',
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    try {
      await enqueueImageGeneration(
        `元素图: ${elementId}`,
        () => api.studioGenerateElementImage(elementId, {
          use_reference: options?.useReference,
          reference_mode: options?.referenceMode,
          width: options?.width,
          height: options?.height,
        }),
      )
      const seriesId = get().currentSeriesId
      if (seriesId) {
        const els = await api.studioGetElements(seriesId)
        set({ sharedElements: els })
      }
      set({ generating: false, generationScope: 'none', generationMessage: '' })
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `generate_element_image:${elementId}`,
        title: '生成元素图',
        retryTask: () => get().generateElementImage(elementId, options),
      })
      set({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `update_shot:${shotId}`,
        title: '更新镜头信息',
        retryTask: () => get().updateShot(shotId, updates),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `delete_shot:${shotId}`,
        title: '删除镜头',
        retryTask: () => get().deleteShot(shotId),
      })
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  generateShotAsset: async (shotId, stage, options) => {
    const stageMessage = stage === 'video'
      ? '正在生成镜头视频'
      : stage === 'audio'
        ? '正在生成镜头音频'
        : stage === 'end_frame'
          ? '正在生成镜头尾帧'
          : stage === 'key_frame'
            ? '正在生成镜头关键帧'
            : '正在生成镜头起始帧'
    set({
      generating: true,
      generationScope: 'single',
      generationMessage: stageMessage,
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    try {
      if (stage === 'video') {
        await enqueueVideoGeneration(
          `镜头视频: ${shotId}`,
          () => api.studioGenerateShotAsset(shotId, {
            stage,
            video_generate_audio: options?.video_generate_audio,
          }),
        )
      } else if (stage === 'frame' || stage === 'end_frame' || stage === 'key_frame') {
        await enqueueImageGeneration(
          stage === 'end_frame' ? `镜头尾帧: ${shotId}` : stage === 'key_frame' ? `镜头关键帧: ${shotId}` : `镜头首帧: ${shotId}`,
          () => api.studioGenerateShotAsset(shotId, { stage }),
        )
      } else {
        await api.studioGenerateShotAsset(shotId, { stage })
      }
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
      set({ generating: false, generationScope: 'none', generationMessage: '' })
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `generate_shot_asset:${shotId}:${stage}`,
        title: stage === 'audio' ? '生成镜头音频' : stage === 'video' ? '生成镜头视频' : '生成镜头画面',
        retryTask: () => get().generateShotAsset(shotId, stage, options),
      })
      set({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
      })
    }
  },

  inpaintShotFrame: async (shotId, params) => {
    set({
      generating: true,
      generationScope: 'single',
      generationMessage: '正在局部重绘镜头',
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    try {
      await api.studioInpaintShotFrame(shotId, params)
      const epId = get().currentEpisodeId
      if (epId) {
        const shots = await api.studioGetShots(epId)
        set({ shots })
      }
      set({ generating: false, generationScope: 'none', generationMessage: '' })
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `inpaint_shot_frame:${shotId}`,
        title: '局部重绘镜头',
        retryTask: () => get().inpaintShotFrame(shotId, params),
      })
      set({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
        error: parsed.message,
        errorCode: parsed.code,
        errorContext: parsed.context,
      })
    }
  },

  reorderShots: async (episodeId, shotIds) => {
    try {
      const shots = await api.studioReorderShots(episodeId, shotIds)
      if (get().currentEpisodeId === episodeId) {
        set({ shots })
      }
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `reorder_shots:${episodeId}`,
        title: '重排镜头顺序',
        retryTask: () => get().reorderShots(episodeId, shotIds),
      })
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  loadEpisodeHistory: async (episodeId, limit = 50, includeSnapshot = false) => {
    const requestSeq = ++loadHistoryRequestSeq
    set({ historyLoading: true })
    try {
      const history = await withTransientRetry(
        () => api.studioGetEpisodeHistory(episodeId, limit, includeSnapshot),
        2,
      )
      if (requestSeq !== loadHistoryRequestSeq) return
      if (get().currentEpisodeId === episodeId) {
        set({ episodeHistory: history, historyLoading: false })
      } else {
        set({ historyLoading: false })
      }
    } catch (e: unknown) {
      if (requestSeq !== loadHistoryRequestSeq) return
      const parsed = queueOperationFailure(set, e, {
        key: `load_episode_history:${episodeId}`,
        title: '加载历史记录',
        retryTask: () => get().loadEpisodeHistory(episodeId, limit, includeSnapshot),
      })
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
      const parsed = queueOperationFailure(set, e, {
        key: `restore_episode_history:${episodeId}:${historyId}`,
        title: '回退历史版本',
        retryTask: () => get().restoreEpisodeHistory(episodeId, historyId),
      })
      set({ historyRestoring: false, error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  undoWorkspaceOperation: async (workspaceId, projectScope) => {
    if (!workspaceId || !projectScope) return
    try {
      await api.workspaceUndo(workspaceId, projectScope)
      const currentEpisodeId = get().currentEpisodeId
      const currentSeriesId = get().currentSeriesId
      if (currentEpisodeId) {
        await get().selectEpisode(currentEpisodeId)
        await get().loadEpisodeHistory(currentEpisodeId, 80, true)
      } else if (currentSeriesId) {
        await get().selectSeries(currentSeriesId)
      } else {
        await get().loadSeriesList()
      }
      // Refresh operation journal to update head position
      get().loadOperationJournal(workspaceId, projectScope)
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `workspace_undo:${workspaceId}:${projectScope}`,
        title: '撤销修改',
        retryTask: () => get().undoWorkspaceOperation(workspaceId, projectScope),
      })
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  redoWorkspaceOperation: async (workspaceId, projectScope) => {
    if (!workspaceId || !projectScope) return
    try {
      await api.workspaceRedo(workspaceId, projectScope)
      const currentEpisodeId = get().currentEpisodeId
      const currentSeriesId = get().currentSeriesId
      if (currentEpisodeId) {
        await get().selectEpisode(currentEpisodeId)
        await get().loadEpisodeHistory(currentEpisodeId, 80, true)
      } else if (currentSeriesId) {
        await get().selectSeries(currentSeriesId)
      } else {
        await get().loadSeriesList()
      }
      // Refresh operation journal to update head position
      get().loadOperationJournal(workspaceId, projectScope)
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `workspace_redo:${workspaceId}:${projectScope}`,
        title: '重做修改',
        retryTask: () => get().redoWorkspaceOperation(workspaceId, projectScope),
      })
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  // -- 操作日志（撤销历史可视化） --
  loadOperationJournal: async (workspaceId, projectScope, limit = 50) => {
    if (!workspaceId || !projectScope) return
    set({ operationJournalLoading: true })
    try {
      const result = await api.listOperations(workspaceId, projectScope, { limit })
      set({
        operationJournal: result.items,
        operationJournalHeadIndex: result.head_index,
        operationJournalTotal: result.total,
        operationJournalLoading: false,
      })
    } catch {
      set({ operationJournalLoading: false })
    }
  },

  setOnlineMembers: (members) => {
    set({ onlineMembers: members })
  },

  // -- 协作 Episode 分配 --
  loadEpisodeAssignments: async (workspaceId, seriesId) => {
    set({ episodeAssignmentsLoading: true })
    try {
      const assignments = await api.listEpisodeAssignments(workspaceId, seriesId ? { series_id: seriesId } : undefined)
      set({ episodeAssignments: assignments, episodeAssignmentsLoading: false })
    } catch {
      set({ episodeAssignmentsLoading: false })
    }
  },

  assignEpisode: async (workspaceId, episodeId, assignedTo, note) => {
    try {
      await api.assignEpisode(workspaceId, episodeId, assignedTo, note)
      const seriesId = get().currentSeriesId
      await get().loadEpisodeAssignments(workspaceId, seriesId || undefined)
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  submitEpisodeForReview: async (workspaceId, episodeId) => {
    try {
      await api.submitEpisodeAssignment(workspaceId, episodeId)
      const seriesId = get().currentSeriesId
      await get().loadEpisodeAssignments(workspaceId, seriesId || undefined)
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  reviewEpisodeAssignment: async (workspaceId, episodeId, action, note) => {
    try {
      if (action === 'approve') {
        await api.approveEpisodeAssignment(workspaceId, episodeId, note)
      } else {
        await api.rejectEpisodeAssignment(workspaceId, episodeId, note)
      }
      const seriesId = get().currentSeriesId
      await get().loadEpisodeAssignments(workspaceId, seriesId || undefined)
    } catch (e: unknown) {
      const parsed = parseStudioError(e)
      set({ error: parsed.message, errorCode: parsed.code, errorContext: parsed.context })
    }
  },

  batchGenerate: async (episodeId, stages, options) => {
    if (generationProgressResetTimer) {
      clearTimeout(generationProgressResetTimer)
      generationProgressResetTimer = null
    }
    set({
      generating: true,
      generationScope: 'batch',
      generationMessage: '正在批量生成',
      error: null,
      errorCode: null,
      errorContext: null,
      generationProgress: createInitialGenerationProgress(),
    })
    const parallel = getGenerationQueueParallelConfig()

    const runFallbackBatch = async () => {
      await api.studioBatchGenerate(episodeId, stages, parallel, options)
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
            parallel,
            options,
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
      set({ generating: false, generationScope: 'none', generationMessage: '' })

      generationProgressResetTimer = setTimeout(() => {
        if (!get().generating) {
          set({ generationProgress: createInitialGenerationProgress() })
        }
        generationProgressResetTimer = null
      }, 2600)
    } catch (e: unknown) {
      const parsed = queueOperationFailure(set, e, {
        key: `batch_generate:${episodeId}:${(stages || []).join(',')}`,
        title: '批量生成',
        retryTask: () => get().batchGenerate(episodeId, stages, options),
      })
      set((state) => ({
        generating: false,
        generationScope: 'none',
        generationMessage: '',
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
