import { Film } from 'lucide-react'
import type { WorkbenchMode } from '../../features/studio/types'
import { getWorkbenchLabel, getWorkbenchWelcomeText } from '../../features/studio/utils'

function WelcomeView({
  mode,
  onCreateClick,
}: {
  mode: WorkbenchMode
  onCreateClick: () => void
}) {
  const title = getWorkbenchLabel(mode)
  const description = getWorkbenchWelcomeText(mode)
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <Film className="w-16 h-16 text-purple-500 mx-auto mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-gray-200 mb-2">{title}</h2>
        <p className="text-sm text-gray-400 mb-6">{description}</p>
        <button
          onClick={onCreateClick}
          className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
        >
          创建第一个系列
        </button>
      </div>
    </div>
  )
}

export default WelcomeView
