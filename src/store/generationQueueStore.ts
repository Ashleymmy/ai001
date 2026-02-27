import { create } from 'zustand'

export type GenerationQueueKind = 'image' | 'video'
export type GenerationQueueStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface GenerationQueueParallelConfig {
  image_max_concurrency: number
  video_max_concurrency: number
  global_max_concurrency: number
}

export interface GenerationQueueItem {
  id: string
  kind: GenerationQueueKind
  label: string
  status: GenerationQueueStatus
  error?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

interface QueueTaskHandler {
  runner: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

interface GenerationQueueState {
  limits: GenerationQueueParallelConfig
  items: GenerationQueueItem[]
  setLimits: (limits: Partial<GenerationQueueParallelConfig>) => void
  enqueueTask: <T>(kind: GenerationQueueKind, label: string, runner: () => Promise<T>) => Promise<T>
  clearFinished: () => void
  pump: () => void
}

const MAX_ITEMS = 240
const taskHandlers = new Map<string, QueueTaskHandler>()
let pumping = false

function nowIso(): string {
  return new Date().toISOString()
}

function createQueueId(kind: GenerationQueueKind): string {
  return `gq_${kind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function countRunningByKind(items: GenerationQueueItem[], kind: GenerationQueueKind): number {
  return items.filter((item) => item.status === 'running' && item.kind === kind).length
}

function countRunning(items: GenerationQueueItem[]): number {
  return items.filter((item) => item.status === 'running').length
}

export const useGenerationQueueStore = create<GenerationQueueState>((set, get) => ({
  limits: {
    image_max_concurrency: 3,
    video_max_concurrency: 2,
    global_max_concurrency: 4,
  },
  items: [],
  setLimits: (limits) => {
    set((state) => ({
      limits: {
        ...state.limits,
        ...Object.fromEntries(
          Object.entries(limits).map(([k, v]) => {
            const n = Number(v)
            return [k, Number.isFinite(n) ? Math.max(1, Math.floor(n)) : state.limits[k as keyof GenerationQueueParallelConfig]]
          }),
        ),
      },
    }))
    get().pump()
  },
  enqueueTask: <T>(kind: GenerationQueueKind, label: string, runner: () => Promise<T>): Promise<T> => {
    const id = createQueueId(kind)
    const item: GenerationQueueItem = {
      id,
      kind,
      label: label || (kind === 'video' ? '视频任务' : '图像任务'),
      status: 'queued',
      createdAt: nowIso(),
    }
    set((state) => ({
      items: [item, ...state.items].slice(0, MAX_ITEMS),
    }))

    const promise = new Promise<T>((resolve, reject) => {
      taskHandlers.set(id, {
        runner: runner as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })

    queueMicrotask(() => get().pump())
    return promise
  },
  clearFinished: () => {
    set((state) => ({
      items: state.items.filter((item) => item.status === 'queued' || item.status === 'running'),
    }))
  },
  pump: () => {
    if (pumping) return
    pumping = true

    try {
      while (true) {
        const state = get()
        const runningTotal = countRunning(state.items)
        if (runningTotal >= state.limits.global_max_concurrency) break

        const queued = [...state.items]
          .reverse()
          .filter((item) => item.status === 'queued')
          .find((item) => {
            const runningKind = countRunningByKind(state.items, item.kind)
            const limit = item.kind === 'video'
              ? state.limits.video_max_concurrency
              : state.limits.image_max_concurrency
            return runningKind < limit
          })

        if (!queued) break

        const handler = taskHandlers.get(queued.id)
        if (!handler) {
          set((current) => ({
            items: current.items.map((item) => (
              item.id === queued.id
                ? {
                    ...item,
                    status: 'failed',
                    error: '任务处理器不存在',
                    finishedAt: nowIso(),
                  }
                : item
            )),
          }))
          continue
        }

        set((current) => ({
          items: current.items.map((item) => (
            item.id === queued.id
              ? {
                  ...item,
                  status: 'running',
                  startedAt: nowIso(),
                }
              : item
          )),
        }))

        void handler.runner()
          .then((value) => {
            set((current) => ({
              items: current.items.map((item) => (
                item.id === queued.id
                  ? {
                      ...item,
                      status: 'completed',
                      finishedAt: nowIso(),
                    }
                  : item
              )),
            }))
            handler.resolve(value)
          })
          .catch((error: unknown) => {
            set((current) => ({
              items: current.items.map((item) => (
                item.id === queued.id
                  ? {
                      ...item,
                      status: 'failed',
                      error: error instanceof Error ? error.message : String(error || '任务失败'),
                      finishedAt: nowIso(),
                    }
                  : item
              )),
            }))
            handler.reject(error)
          })
          .finally(() => {
            taskHandlers.delete(queued.id)
            get().pump()
          })
      }
    } finally {
      pumping = false
    }
  },
}))

export function getGenerationQueueParallelConfig(): GenerationQueueParallelConfig {
  return useGenerationQueueStore.getState().limits
}

export function enqueueImageGeneration<T>(label: string, runner: () => Promise<T>): Promise<T> {
  return useGenerationQueueStore.getState().enqueueTask('image', label, runner)
}

export function enqueueVideoGeneration<T>(label: string, runner: () => Promise<T>): Promise<T> {
  return useGenerationQueueStore.getState().enqueueTask('video', label, runner)
}
