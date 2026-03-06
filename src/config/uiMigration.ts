export const UI_MIGRATION = {
  betaEnabled: true,
  defaultVariant: 'legacy' as 'legacy' | 'v2',
  routes: {
    agentV2: '/agent-v2',
    studioV2: '/studio-v2',
  },
} as const

export const UI_MIGRATION_STORAGE_KEY = 'ui.migration.variant'

export function resolveUiVariant(): 'legacy' | 'v2' {
  if (typeof window === 'undefined') return UI_MIGRATION.defaultVariant
  try {
    const stored = window.localStorage.getItem(UI_MIGRATION_STORAGE_KEY)
    if (stored === 'legacy' || stored === 'v2') return stored
  } catch {
    // ignore
  }
  return UI_MIGRATION.defaultVariant
}

export function persistUiVariant(variant: 'legacy' | 'v2'): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UI_MIGRATION_STORAGE_KEY, variant)
  } catch {
    // ignore
  }
}
