import { Loader2, Wand2 } from 'lucide-react'
import type { StudioActivityIndicator } from '../../features/studio/types'

function StudioDynamicIsland({ indicator }: { indicator: StudioActivityIndicator }) {
  const toneCls =
    indicator.tone === 'error' ? 'border-red-700/70 from-red-900/50 to-gray-900 text-red-100' :
    indicator.tone === 'warning' ? 'border-amber-700/70 from-amber-900/45 to-gray-900 text-amber-100' :
    indicator.tone === 'success' ? 'border-emerald-700/70 from-emerald-900/40 to-gray-900 text-emerald-100' :
    indicator.tone === 'working' ? 'border-purple-700/70 from-purple-900/45 to-gray-900 text-purple-100' :
    indicator.tone === 'info' ? 'border-blue-700/70 from-blue-900/45 to-gray-900 text-blue-100' :
    'border-gray-700 from-gray-900/95 to-gray-900 text-gray-200'

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[72] pointer-events-none">
      <div
        className={`pointer-events-auto rounded-2xl border bg-gradient-to-b shadow-2xl backdrop-blur transition-all duration-250 ease-out overflow-hidden ${
          indicator.active ? 'w-[min(520px,92vw)] px-4 py-2.5' : 'w-[min(340px,88vw)] px-4 py-1.5'
        } ${toneCls}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{indicator.title}</p>
            <p className="text-[11px] text-gray-300 truncate">{indicator.detail}</p>
          </div>
          {indicator.active ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 opacity-80" />
          ) : (
            <Wand2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
          )}
        </div>
        <div className={`transition-all duration-250 ${indicator.active ? 'max-h-12 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'}`}>
          <div className="h-1.5 rounded-full bg-gray-900/70 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-300 transition-all duration-300"
              style={{ width: `${Math.max(10, indicator.progress ?? 35)}%` }}
            />
          </div>
          {typeof indicator.progress === 'number' && (
            <div className="mt-1 text-[10px] text-gray-300 text-right">{indicator.progress.toFixed(0)}%</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default StudioDynamicIsland
