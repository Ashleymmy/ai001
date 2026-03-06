import './styles-v2-import'
import StudioWorkbenchBody from '../features/studio-v2/StudioWorkbenchBody'

export default function StudioPageV2() {
  return (
    <div className="ui-v2 h-screen w-screen overflow-hidden">
      <StudioWorkbenchBody routeBase="/studio-v2" />
    </div>
  )
}
