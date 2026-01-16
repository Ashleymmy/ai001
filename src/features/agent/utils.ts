export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const mb = 1024 * 1024
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function sanitizeFilename(name: string | null | undefined, fallback = 'file'): string {
  const safe = (name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim()
  return safe || fallback
}

