/**
 * 功能模块：Studio 组件模块，悬浮概览面板（HoverOverviewPanel）
 */

import type { ReactNode } from 'react'

export default function HoverOverviewPanel({
  children,
  maxWidthClass = 'max-w-3xl',
}: {
  children: ReactNode
  maxWidthClass?: string
}) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center px-4 py-8 opacity-0 scale-[0.97] transition-all duration-150 delay-0 group-hover:delay-700 group-focus-within:delay-300 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100">
      <div className={`w-full ${maxWidthClass} rounded-xl border border-gray-600 bg-gray-950/95 p-4 shadow-2xl backdrop-blur-sm`}>
        {children}
      </div>
    </div>
  )
}
