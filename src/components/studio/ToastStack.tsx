import { useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import type { StudioToast } from '../../features/studio/types'

function ToastStack({
  toasts,
  onClose,
}: {
  toasts: StudioToast[]
  onClose: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <div className="fixed top-14 right-4 z-[70] space-y-2 w-96 max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <div key={toast.id} className="bg-gray-900 border border-red-800/60 rounded-lg shadow-lg p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-red-200 break-words">{toast.message}</p>
                {toast.code && <p className="text-xs text-red-300/70 mt-1">code: {toast.code}</p>}
              </div>
            </div>
            <button onClick={() => onClose(toast.id)} className="text-gray-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {toast.context && Object.keys(toast.context).length > 0 && (
            <div className="mt-2">
              <button
                className="text-xs text-gray-400 hover:text-white"
                onClick={() => setExpanded((prev) => ({ ...prev, [toast.id]: !prev[toast.id] }))}
              >
                {expanded[toast.id] ? '收起详情' : '查看详情'}
              </button>
              {expanded[toast.id] && (
                <pre className="mt-2 text-xs text-gray-400 bg-gray-950 border border-gray-800 rounded p-2 whitespace-pre-wrap">
                  {JSON.stringify(toast.context, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default ToastStack
