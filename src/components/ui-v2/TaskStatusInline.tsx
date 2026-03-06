interface TaskStatusInlineProps {
  running?: boolean
  error?: string | null
  label?: string
  className?: string
}

export default function TaskStatusInline({ running, error, label, className }: TaskStatusInlineProps) {
  if (!running && !error) return null
  if (error) {
    return <span className={['text-xs text-red-600', className || ''].join(' ').trim()}>{label || error}</span>
  }
  return (
    <span className={['inline-flex items-center gap-1 text-xs text-[var(--v2-text-secondary)]', className || ''].join(' ').trim()}>
      <span className="w-3 h-3 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
      {label || '处理中'}
    </span>
  )
}
