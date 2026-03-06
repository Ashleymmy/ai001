import type { WorkbenchMode } from '../studio/types'
import StudioPage from '../../pages/StudioPage'

interface StudioWorkbenchBodyProps {
  forcedWorkbenchMode?: WorkbenchMode
  routeBase?: '/studio' | '/short-video' | '/digital-human' | '/studio-v2'
}

export default function StudioWorkbenchBody({ forcedWorkbenchMode, routeBase = '/studio-v2' }: StudioWorkbenchBodyProps) {
  return <StudioPage forcedWorkbenchMode={forcedWorkbenchMode} routeBase={routeBase} />
}
