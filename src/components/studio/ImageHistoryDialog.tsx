/**
 * 功能模块：Studio 组件模块，图片历史对话框（ImageHistoryDialog）
 */

import { Trash2, X } from 'lucide-react'

export default function ImageHistoryDialog({
  title,
  current,
  history,
  onClose,
  onApply,
  onDelete,
  deletingUrl,
}: {
  title: string
  current: string
  history: string[]
  onClose: () => void
  onApply: (url: string) => void
  onDelete?: (url: string, isCurrent: boolean) => void | Promise<void>
  deletingUrl?: string | null
}) {
  const list = [current, ...history.slice().reverse()].filter((url, idx, arr) => !!url && arr.indexOf(url) === idx)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto max-h-[78vh]">
          {list.map((url, idx) => (
            <div
              key={`${url}_${idx}`}
              className={`rounded-lg border overflow-hidden ${
                url === current ? 'border-purple-500' : 'border-gray-800 hover:border-purple-600'
              }`}
            >
              <button
                onClick={() => onApply(url)}
                className="w-full text-left"
              >
                <div className="aspect-video bg-gray-800">
                  <img src={url} alt={`history-${idx}`} className="w-full h-full object-cover" />
                </div>
              </button>
              <div className="px-2 py-1.5 text-xs text-gray-300 flex items-center justify-between gap-2">
                <span>{idx === 0 ? '当前' : `历史 #${idx}`}</span>
                {onDelete && (
                  <button
                    onClick={() => onDelete(url, url === current)}
                    disabled={deletingUrl === url}
                    className="text-[11px] inline-flex items-center gap-1 text-red-300 hover:text-red-200 disabled:opacity-50"
                    title="删除该图片"
                  >
                    {deletingUrl === url ? (
                      '删除中...'
                    ) : (
                      <>
                        <Trash2 className="w-3 h-3" />
                        删除
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
