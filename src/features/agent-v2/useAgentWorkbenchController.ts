import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export type AgentV2Stage = 'elements' | 'storyboard' | 'audio' | 'timeline'

const STAGES: AgentV2Stage[] = ['elements', 'storyboard', 'audio', 'timeline']

export function useAgentWorkbenchController() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const stage = useMemo<AgentV2Stage>(() => {
    const raw = String(searchParams.get('stage') || '').trim().toLowerCase()
    return (STAGES.includes(raw as AgentV2Stage) ? raw : 'elements') as AgentV2Stage
  }, [searchParams])

  const setStage = useCallback(
    (next: AgentV2Stage) => {
      const query = new URLSearchParams(searchParams)
      query.set('stage', next)
      navigate(`${location.pathname}?${query.toString()}`, { replace: true })
    },
    [location.pathname, navigate, searchParams],
  )

  return {
    stage,
    setStage,
    stageItems: STAGES,
  }
}
