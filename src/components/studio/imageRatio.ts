export type StudioImageRatioValue =
  | '16:9'
  | '4:3'
  | '1:1'
  | '3:4'
  | '9:16'
  | '2:3'
  | '3:2'
  | '21:9'

export type StudioImageResolutionValue = '1k' | '2k' | '4k'

export interface StudioImageRatioPreset {
  value: StudioImageRatioValue
  label: string
  width: number
  height: number
}

export interface StudioImageResolutionPreset {
  value: StudioImageResolutionValue
  label: string
  longEdge: number
}

export const STUDIO_IMAGE_RATIO_PRESETS: StudioImageRatioPreset[] = [
  { value: '1:1', label: '方图 1:1', width: 1024, height: 1024 },
  { value: '3:4', label: '竖图 3:4', width: 768, height: 1024 },
  { value: '4:3', label: '横屏 4:3', width: 1024, height: 768 },
  { value: '16:9', label: '横屏 16:9', width: 1280, height: 720 },
  { value: '9:16', label: '竖屏 9:16', width: 720, height: 1280 },
  { value: '2:3', label: '竖图 2:3', width: 683, height: 1024 },
  { value: '3:2', label: '横版 3:2', width: 1024, height: 683 },
  { value: '21:9', label: '超宽 21:9', width: 1344, height: 576 },
]

export const STUDIO_IMAGE_RESOLUTION_PRESETS: StudioImageResolutionPreset[] = [
  { value: '1k', label: '1K', longEdge: 1024 },
  { value: '2k', label: '2K', longEdge: 2048 },
  { value: '4k', label: '4K', longEdge: 4096 },
]

export function isStudioImageRatioValue(value: string): value is StudioImageRatioValue {
  return STUDIO_IMAGE_RATIO_PRESETS.some((item) => item.value === value)
}

export function isStudioImageResolutionValue(value: string): value is StudioImageResolutionValue {
  return STUDIO_IMAGE_RESOLUTION_PRESETS.some((item) => item.value === value)
}

export function resolveStudioImageRatioPreset(
  value: StudioImageRatioValue | string | null | undefined,
  fallback: StudioImageRatioValue = '16:9',
): StudioImageRatioPreset {
  const fromValue = STUDIO_IMAGE_RATIO_PRESETS.find((item) => item.value === value)
  if (fromValue) return fromValue
  return STUDIO_IMAGE_RATIO_PRESETS.find((item) => item.value === fallback) || STUDIO_IMAGE_RATIO_PRESETS[0]
}

export function resolveStudioImageResolutionPreset(
  value: StudioImageResolutionValue | string | null | undefined,
  fallback: StudioImageResolutionValue = '2k',
): StudioImageResolutionPreset {
  const fromValue = STUDIO_IMAGE_RESOLUTION_PRESETS.find((item) => item.value === value)
  if (fromValue) return fromValue
  return STUDIO_IMAGE_RESOLUTION_PRESETS.find((item) => item.value === fallback) || STUDIO_IMAGE_RESOLUTION_PRESETS[0]
}

export function clampStudioImageDimension(value: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback
  const rounded = Math.round(finite)
  return Math.max(128, Math.min(4096, rounded))
}

export function resolveStudioImageSizeByRatio(
  ratio: StudioImageRatioValue | string | null | undefined,
  longEdge: number,
  fallbackRatio: StudioImageRatioValue = '1:1',
): { width: number; height: number } {
  const preset = resolveStudioImageRatioPreset(ratio, fallbackRatio)
  const rw = Math.max(1, preset.width)
  const rh = Math.max(1, preset.height)
  const safeLong = clampStudioImageDimension(longEdge, 1024)
  if (rw >= rh) {
    const w = safeLong
    const h = clampStudioImageDimension((safeLong * rh) / rw, 1024)
    return { width: w, height: h }
  }
  const h = safeLong
  const w = clampStudioImageDimension((safeLong * rw) / rh, 1024)
  return { width: w, height: h }
}
