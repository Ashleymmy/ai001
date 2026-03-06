import { useMemo } from 'react'

export interface LLMStageItem {
  id: string
  title: string
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed'
  progress?: number
  meta?: string
}

interface LLMStageStreamCardProps {
  title: string
  stages: LLMStageItem[]
  outputText?: string
  activeMessage?: string
  mode?: 'legacy' | 'task_queue'
  taskId?: string
}

function chipClass(status: LLMStageItem['status']): string {
  if (status === 'completed') return 'v2-chip v2-chip-success'
  if (status === 'failed') return 'v2-chip v2-chip-danger'
  if (status === 'processing') return 'v2-chip v2-chip-info'
  if (status === 'queued') return 'v2-chip v2-chip-warning'
  return 'v2-chip v2-chip-info'
}

export default function LLMStageStreamCard({ title, stages, outputText, activeMessage, mode, taskId }: LLMStageStreamCardProps) {
  const completed = stages.filter((s) => s.status === 'completed').length
  const total = Math.max(stages.length, 1)
  const overall = useMemo(() => {
    const explicit = stages.reduce((acc, s) => acc + (typeof s.progress === 'number' ? Math.max(0, Math.min(100, s.progress)) : 0), 0)
    const fallback = (completed / total) * 100
    return Math.max(fallback, explicit / total)
  }, [completed, stages, total])

  return (
    <section className="v2-glass-surface-strong p-3.5 v2-animate-fade-up">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">{title}</h4>
        <div className="flex items-center gap-1.5">
          {mode && <span className="v2-chip v2-chip-info">{mode}</span>}
          {taskId && <span className="v2-chip v2-chip-warning">task {taskId.slice(0, 8)}</span>}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-3">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${Math.max(2, Math.min(100, overall))}%`, background: 'linear-gradient(90deg, var(--v2-accent-from), var(--v2-accent-to))' }}
        />
      </div>
      <div className="space-y-1.5 max-h-40 overflow-auto pr-1">
        {stages.map((stage) => (
          <div key={stage.id} className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <p className="font-medium text-[var(--v2-text-primary)] truncate">{stage.title}</p>
              {stage.meta ? <p className="text-[var(--v2-text-tertiary)] truncate">{stage.meta}</p> : null}
            </div>
            <span className={chipClass(stage.status)}>{stage.status}</span>
          </div>
        ))}
      </div>
      {activeMessage ? <p className="mt-2 text-xs text-[var(--v2-text-secondary)]">{activeMessage}</p> : null}
      {outputText ? (
        <pre className="mt-2 rounded-xl bg-slate-900 text-slate-200 text-[11px] leading-5 p-2.5 overflow-auto max-h-32 whitespace-pre-wrap">
          {outputText}
        </pre>
      ) : null}
    </section>
  )
}
