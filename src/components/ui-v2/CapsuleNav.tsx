import type { ReactNode } from 'react'

export type V2CapsuleItemStatus = 'idle' | 'processing' | 'done' | 'error'

export interface V2CapsuleItem {
  id: string
  label: string
  icon?: ReactNode
  status?: V2CapsuleItemStatus
}

interface CapsuleNavProps {
  items: V2CapsuleItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

function statusDot(status: V2CapsuleItemStatus | undefined): string {
  if (status === 'done') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  if (status === 'processing') return 'bg-sky-500 animate-pulse'
  return 'bg-slate-300'
}

export default function CapsuleNav({ items, activeId, onChange, className }: CapsuleNavProps) {
  return (
    <nav className={className || ''}>
      <div className="v2-glass-nav inline-flex items-center p-1.5 gap-1.5">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={[
                'px-3.5 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-2',
                active
                  ? 'text-white shadow-sm'
                  : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-white/50',
              ].join(' ')}
              style={active ? { background: 'linear-gradient(135deg, var(--v2-accent-from), var(--v2-accent-to))' } : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(item.status)}`} />
            </button>
          )
        })}
      </div>
    </nav>
  )
}
