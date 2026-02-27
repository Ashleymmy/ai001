/**
 * 功能模块：Studio 组件模块，图片历史对话框（ImageHistoryDialog）
 */

import { X } from 'lucide-react'

export default function ImageHistoryDialog({
  title,
  current,
  history,
  onClose,
  onApply,
}: {
  title: string
  current: string
  history: string[]
  onClose: () => void
  onApply: (url: string) => void
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
            <button
              key={`${url}_${idx}`}
              onClick={() => onApply(url)}
              className={`text-left rounded-lg border overflow-hidden ${
                url === current ? 'border-purple-500' : 'border-gray-800 hover:border-purple-600'
              }`}
            >
              <div className="aspect-video bg-gray-800">
                <img src={url} alt={`history-${idx}`} className="w-full h-full object-cover" />
              </div>
              <div className="px-2 py-1 text-xs text-gray-300">
                {idx === 0 ? '当前' : `历史 #${idx}`}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
