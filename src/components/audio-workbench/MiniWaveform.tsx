import { useEffect, useMemo, useRef, useState } from 'react'

type PeaksData = { peaks: Float32Array; duration: number }

const peaksCache = new Map<string, Promise<PeaksData>>()

function getAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  const w = window as unknown as { __miniWaveformAudioCtx?: AudioContext }
  if (!w.__miniWaveformAudioCtx) w.__miniWaveformAudioCtx = new Ctx()
  return w.__miniWaveformAudioCtx
}

async function loadPeaks(url: string, points: number): Promise<PeaksData> {
  const ctx = getAudioContext()
  if (!ctx) return { peaks: new Float32Array(0), duration: 0 }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const ab = await res.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(ab.slice(0))
  const duration = Number(audioBuffer.duration) || 0
  const data = audioBuffer.getChannelData(0)
  if (!data || data.length === 0 || points <= 0) return { peaks: new Float32Array(0), duration }

  const peaks = new Float32Array(points)
  const block = Math.max(1, Math.floor(data.length / points))
  for (let i = 0; i < points; i++) {
    const start = i * block
    const end = i === points - 1 ? data.length : Math.min(data.length, start + block)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j] || 0)
      if (v > max) max = v
    }
    peaks[i] = max
  }
  return { peaks, duration }
}

function getPeaks(url: string, points: number): Promise<PeaksData> {
  const key = `${url}::${points}`
  const cached = peaksCache.get(key)
  if (cached) return cached
  const p = loadPeaks(url, points)
  peaksCache.set(key, p)
  return p
}

function drawWaveform(ctx: CanvasRenderingContext2D, peaks: Float32Array, color: string, widthCss: number, heightCss: number) {
  ctx.clearRect(0, 0, widthCss, heightCss)
  if (!peaks || peaks.length === 0 || widthCss <= 0 || heightCss <= 0) return

  ctx.fillStyle = color
  const mid = heightCss / 2
  for (let x = 0; x < widthCss; x++) {
    const p = x / Math.max(1, widthCss - 1)
    const idx = Math.floor(p * Math.max(1, peaks.length - 1))
    const v = peaks[idx] || 0
    const bar = Math.max(1, v * mid)
    ctx.fillRect(x, mid - bar, 1, bar * 2)
  }
}

export default function MiniWaveform({
  url,
  height = 22,
  color = 'rgba(147,197,253,0.75)',
  className,
}: {
  url: string
  height?: number
  color?: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0))

  const points = 1200
  const enabled = Boolean(url && url.trim())
  const resolvedUrl = useMemo(() => (url || '').trim(), [url])

  useEffect(() => {
    setError(null)
    setPeaks(new Float32Array(0))
    if (!enabled) return

    let cancelled = false
    void (async () => {
      try {
        const res = await getPeaks(resolvedUrl, points)
        if (cancelled) return
        setPeaks(res.peaks)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'load failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, points, resolvedUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const cssW = Math.max(0, Math.floor(canvas.clientWidth))
      const cssH = Math.max(0, Math.floor(height))
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawWaveform(ctx, peaks, color, cssW, cssH)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [color, height, peaks])

  return (
    <div className={className} style={{ height }}>
      {error ? (
        <div className="text-[10px] text-red-300 truncate" title={error}>
          waveform error
        </div>
      ) : (
        <canvas ref={canvasRef} className="w-full h-full block" />
      )}
    </div>
  )
}
