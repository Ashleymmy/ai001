import { useState, useEffect } from 'react'
import {
  Image,
  Wand2,
  Download,
  RefreshCw,
  Trash2,
  AlertCircle,
  History
} from 'lucide-react'
import ModuleChat from '../components/ModuleChat'
import { generateImage, getImageHistory } from '../services/api'

interface GeneratedImage {
  id: string
  prompt: string
  url: string
  negativePrompt?: string
  status: 'generating' | 'done' | 'error'
  createdAt?: string
}

export default function ImagePage() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 加载历史记录
  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      const history = await getImageHistory(100)
      const loadedImages: GeneratedImage[] = history.map((img) => ({
        id: img.id,
        prompt: img.prompt,
        url: img.image_url,
        negativePrompt: img.negative_prompt,
        status: 'done' as const,
        createdAt: img.created_at
      }))
      setImages(loadedImages)
    } catch (err) {
      console.error('加载历史记录失败:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    setError(null)

    const tempId = Date.now().toString()
    const newImage: GeneratedImage = {
      id: tempId,
      prompt: prompt,
      url: '',
      negativePrompt: negativePrompt,
      status: 'generating'
    }
    setImages((prev) => [newImage, ...prev])

    try {
      // generateImage 内部会保存到历史记录
      const imageUrl = await generateImage(prompt, negativePrompt || undefined)

      setImages((prev) =>
        prev.map((img) =>
          img.id === tempId
            ? { ...img, url: imageUrl, status: 'done' as const }
            : img
        )
      )
    } catch (err) {
      console.error('生成失败:', err)
      setError('图像生成失败，请检查设置中的图像模型配置')
      setImages((prev) =>
        prev.map((img) =>
          img.id === tempId ? { ...img, status: 'error' as const } : img
        )
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = async (img: GeneratedImage) => {
    setImages((prev) =>
      prev.map((i) =>
        i.id === img.id ? { ...i, status: 'generating' as const } : i
      )
    )

    try {
      const imageUrl = await generateImage(
        img.prompt,
        img.negativePrompt || undefined
      )
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id
            ? { ...i, url: imageUrl, status: 'done' as const }
            : i
        )
      )
    } catch (err) {
      console.error('重新生成失败:', err)
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id ? { ...i, status: 'error' as const } : i
        )
      )
    }
  }

  const handleDelete = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
    if (selectedImage?.id === id) {
      setSelectedImage(null)
    }
  }

  const handleDownload = (img: GeneratedImage) => {
    const a = document.createElement('a')
    a.href = img.url
    a.download = `image-${img.id}.png`
    a.click()
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Image size={20} className="text-purple-400" />
            <h1 className="text-lg font-semibold">图像生成</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <History size={16} />
            <span>{images.filter((i) => i.status === 'done').length} 张图像</span>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg text-sm">
            <AlertCircle size={16} />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              ×
            </button>
          </div>
        )}

        <div className="p-6 border-b border-gray-800 space-y-3">
          <div className="flex gap-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图像...&#10;例如：一位穿着红色连衣裙的女孩站在樱花树下，电影感光影，浅景深"
              className="flex-1 bg-[#1a1a1a] rounded-xl p-4 text-sm resize-none border border-gray-800 focus:border-primary/50 focus:outline-none h-24"
            />
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="px-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              {isGenerating ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <Wand2 size={18} />
              )}
              生成
            </button>
          </div>

          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-400 hover:text-white"
            >
              {showAdvanced ? '收起' : '展开'}高级选项
            </button>

            {showAdvanced && (
              <div className="mt-3">
                <label className="block text-sm text-gray-400 mb-1">
                  负面提示词
                </label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="blurry, low quality, distorted..."
                  className="w-full bg-[#1a1a1a] rounded-lg p-3 text-sm border border-gray-800 focus:border-primary/50 focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 p-6 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <RefreshCw size={32} className="animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Image size={64} className="mb-4 opacity-30" />
              <p>还没有生成的图像</p>
              <p className="text-sm">输入提示词后点击生成</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {images.map((img) => (
                <div
                  key={img.id}
                  onClick={() => img.status === 'done' && setSelectedImage(img)}
                  className={`relative group cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
                    selectedImage?.id === img.id
                      ? 'border-primary'
                      : 'border-transparent hover:border-gray-600'
                  }`}
                >
                  {img.status === 'generating' ? (
                    <div className="w-full aspect-square bg-[#1a1a1a] flex items-center justify-center">
                      <RefreshCw
                        size={32}
                        className="animate-spin text-gray-600"
                      />
                    </div>
                  ) : img.status === 'error' ? (
                    <div className="w-full aspect-square bg-[#1a1a1a] flex flex-col items-center justify-center text-red-400">
                      <AlertCircle size={32} className="mb-2" />
                      <span className="text-sm">生成失败</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRegenerate(img)
                        }}
                        className="mt-2 text-xs text-gray-400 hover:text-white"
                      >
                        重试
                      </button>
                    </div>
                  ) : (
                    <>
                      <img
                        src={img.url}
                        alt={img.prompt}
                        className="w-full aspect-square object-cover"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownload(img)
                          }}
                          className="p-2 bg-white/20 rounded-lg hover:bg-white/30"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRegenerate(img)
                          }}
                          className="p-2 bg-white/20 rounded-lg hover:bg-white/30"
                        >
                          <RefreshCw size={18} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(img.id)
                          }}
                          className="p-2 bg-white/20 rounded-lg hover:bg-red-500/50"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedImage && selectedImage.status === 'done' && (
          <div className="p-4 border-t border-gray-800 bg-[#1a1a1a]">
            <p className="text-sm text-gray-400 truncate">
              提示词: {selectedImage.prompt}
            </p>
          </div>
        )}
      </div>

      <div className="w-96 border-l border-gray-800 flex flex-col">
        <ModuleChat
          moduleType="image"
          placeholder="描述画面，或让 AI 帮你优化提示词..."
          context={prompt ? `当前提示词：${prompt}` : undefined}
        />
      </div>
    </div>
  )
}
