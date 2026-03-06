import type { ReactNode } from 'react'

interface StageShellProps {
  header?: ReactNode
  nav?: ReactNode
  side?: ReactNode
  children: ReactNode
}

export default function StageShell({ header, nav, side, children }: StageShellProps) {
  return (
    <div className="ui-v2 h-screen w-screen overflow-hidden">
      <div className="h-full w-full flex flex-col p-3 gap-3">
        {header ? <div className="shrink-0">{header}</div> : null}
        {nav ? <div className="shrink-0">{nav}</div> : null}
        <div className="flex-1 min-h-0 flex gap-3">
          <div className="flex-1 min-w-0 v2-glass-surface-strong overflow-hidden">{children}</div>
          {side ? <aside className="w-[360px] max-w-[38vw] min-w-[280px] shrink-0 space-y-3">{side}</aside> : null}
        </div>
      </div>
    </div>
  )
}
