import { useState, useRef, useEffect, useCallback } from 'react'
import { Paintbrush, Eraser, Trash2 } from 'lucide-react'

interface InpaintCanvasProps {
  imageUrl: string
  maskData: string
  onMaskChange: (maskBase64: string) => void
  width?: number
  height?: number
}

const BRUSH_SIZES = [
  { label: '小', value: 8 },
  { label: '中', value: 20 },
  { label: '大', value: 40 },
]

export default function InpaintCanvas({
  imageUrl,
  maskData: _maskData,
  onMaskChange,
}: InpaintCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [brushSize, setBrushSize] = useState(20)
  const [isDrawing, setIsDrawing] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  // 加载底图
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
    }
    img.src = imageUrl
    return () => { img.onload = null }
  }, [imageUrl])

  // 初始化 canvas 尺寸
  useEffect(() => {
    if (!imgLoaded || !canvasRef.current || !containerRef.current) return
    const img = imgRef.current!
    const containerW = containerRef.current.clientWidth
    const scale = containerW / img.naturalWidth
    const canvasW = containerW
    const canvasH = Math.round(img.naturalHeight * scale)
    canvasRef.current.width = canvasW
    canvasRef.current.height = canvasH
  }, [imgLoaded])

  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }, [])

  const drawStroke = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }, [tool, brushSize])

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // 创建纯黑白 mask：在一个临时 canvas 上将蒙版区域绘制为白色
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const mctx = maskCanvas.getContext('2d')
    if (!mctx) return
    // 黑色底（保留区域）
    mctx.fillStyle = '#000000'
    mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
    // 将绘制层叠加，有内容的地方变成白色（重绘区域）
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const maskImageData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] > 10) {
        maskImageData.data[i] = 255
        maskImageData.data[i + 1] = 255
        maskImageData.data[i + 2] = 255
        maskImageData.data[i + 3] = 255
      }
    }
    mctx.putImageData(maskImageData, 0, 0)
    const base64 = maskCanvas.toDataURL('image/png')
    onMaskChange(base64)
  }, [onMaskChange])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    const pt = getCanvasPoint(e)
    lastPoint.current = pt
    drawStroke(pt, pt)
  }, [getCanvasPoint, drawStroke])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPoint.current) return
    const pt = getCanvasPoint(e)
    drawStroke(lastPoint.current, pt)
    lastPoint.current = pt
  }, [isDrawing, getCanvasPoint, drawStroke])

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      lastPoint.current = null
      exportMask()
    }
  }, [isDrawing, exportMask])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onMaskChange('')
  }, [onMaskChange])

  if (!imgLoaded) {
    return (
      <div className="w-full h-24 flex items-center justify-center text-xs text-gray-500">
        加载图片中...
      </div>
    )
  }

  const img = imgRef.current!
  const aspectRatio = img.naturalWidth / img.naturalHeight

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setTool('brush')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            tool === 'brush' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          <Paintbrush className="w-3 h-3" />
          画笔
        </button>
        <button
          onClick={() => setTool('eraser')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            tool === 'eraser' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          <Eraser className="w-3 h-3" />
          橡皮
        </button>
        <div className="flex items-center gap-1 ml-1">
          {BRUSH_SIZES.map((s) => (
            <button
              key={s.value}
              onClick={() => setBrushSize(s.value)}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                brushSize === s.value ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleClear}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800 text-gray-400 hover:text-red-400 transition-colors ml-auto"
        >
          <Trash2 className="w-3 h-3" />
          清除
        </button>
      </div>
      <div
        ref={containerRef}
        className="relative w-full rounded overflow-hidden border border-gray-700 bg-gray-900"
        style={{ aspectRatio: String(aspectRatio) }}
      >
        <img
          src={imageUrl}
          alt="inpaint base"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      <p className="text-[10px] text-gray-500">在图片上涂抹需要重绘的区域（白色=重绘，黑色=保留）</p>
    </div>
  )
}
