import { useMemo } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
import type { StudioFailedOperation, StudioRetryRecord } from '../../store/studioStore'
import { formatRelativeTime } from '../../features/studio/utils'

function RecoveryCenterPanel({
  failedOperations,
  retryHistory,
  onRetry,
  onDismiss,
  onClearResolved,
  onClearHistory,
  onClose,
}: {
  failedOperations: StudioFailedOperation[]
  retryHistory: StudioRetryRecord[]
  onRetry: (operationId: string) => void
  onDismiss: (operationId: string) => void
  onClearResolved: () => void
  onClearHistory: () => void
  onClose: () => void
}) {
  const orderedFailedOperations = useMemo(
    () => [...failedOperations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [failedOperations],
  )
  const orderedRetryHistory = useMemo(
    () => [...retryHistory].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()),
    [retryHistory],
  )

  return (
    <div className="fixed top-14 right-2 md:right-4 xl:right-[26rem] z-[69] w-[min(460px,calc(100vw-1rem))] rounded-xl border border-gray-700 bg-gray-950/96 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">恢复中心</p>
          <p className="text-[11px] text-gray-500">失败队列与重试记录</p>
        </div>
        <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 border-b border-gray-800">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-300">失败队列</h4>
          <button
            onClick={onClearResolved}
            className="text-[11px] text-gray-500 hover:text-gray-200"
          >
            清理已恢复
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
          {orderedFailedOperations.length === 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-500">
              当前没有失败操作
            </div>
          )}
          {orderedFailedOperations.map((operation) => (
            <div key={operation.id} className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-100 truncate">{operation.title}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{operation.message}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {formatRelativeTime(operation.updatedAt)} · 重试 {operation.retryCount} 次
                    {operation.code ? ` · ${operation.code}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                  operation.status === 'resolved'
                    ? 'bg-emerald-900/40 text-emerald-300'
                    : operation.status === 'retrying'
                      ? 'bg-blue-900/40 text-blue-300'
                      : 'bg-red-900/40 text-red-300'
                }`}>
                  {operation.status === 'resolved' ? '已恢复' : operation.status === 'retrying' ? '重试中' : '失败'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                {operation.status !== 'resolved' && (
                  <button
                    onClick={() => onRetry(operation.id)}
                    disabled={operation.status === 'retrying' || !operation.retryable}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {operation.status === 'retrying' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    {operation.status === 'retrying' ? '处理中' : '重试'}
                  </button>
                )}
                <button
                  onClick={() => onDismiss(operation.id)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  <X className="w-3 h-3" />
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-300">重试历史</h4>
          <button
            onClick={onClearHistory}
            className="text-[11px] text-gray-500 hover:text-gray-200"
          >
            清空历史
          </button>
        </div>
        <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
          {orderedRetryHistory.length === 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-500">
              暂无重试记录
            </div>
          )}
          {orderedRetryHistory.slice(0, 12).map((record) => (
            <div key={record.id} className="rounded border border-gray-800 bg-gray-900/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-gray-200 line-clamp-1">{record.operationTitle}</p>
                <span className={`text-[10px] shrink-0 ${record.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {record.success ? '成功' : '失败'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">
                第 {record.attempt} 次 · {formatRelativeTime(record.finishedAt)}
              </p>
              {!record.success && (
                <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{record.message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default RecoveryCenterPanel
