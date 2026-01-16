import { useEffect, useState, useCallback } from 'react'
import {
  Upload,
  Wand2,
  Download,
  RefreshCw,
  Trash2,
  Film,
  AlertCircle,
  Check,
  X
} from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import {
  generateStoryboards,
  regenerateImage,
  healthCheck
} from '../services/api'
import { STYLES } from '../features/editor/constants'

export default function EditorPage() {
  const {
    currentProject,
    createProject,
    setReferenceImage,
    setStoryText,
    setStyle,
    addStoryboard,
    updateStoryboard,
    removeStoryboard,
    clearStoryboards
  } = useProjectStore()

  const [isGenerating, setIsGenerating] = useState(false)
  const [storyboardCount, setStoryboardCount] = useState(4)
  const [backendStatus, setBackendStatus] = useState<
    'checking' | 'online' | 'offline'
  >('checking')
  const [error, setError] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  // 检查后端状态
  useEffect(() => {
    const checkBackend = async () => {
      const isOnline = await healthCheck()
      setBackendStatus(isOnline ? 'online' : 'offline')
    }
    checkBackend()
    const interval = setInterval(checkBackend, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!currentProject) {
      createProject('未命名项目')
    }
  }, [currentProject, createProject])

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string
          setReferenceImage(dataUrl)
        }
        reader.readAsDataURL(file)
      }
    },
    [setReferenceImage]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string
          setReferenceImage(dataUrl)
        }
        reader.readAsDataURL(file)
      }
    },
    [setReferenceImage]
  )

  const handleGenerate = async () => {
    if (!currentProject?.storyText) return
    if (backendStatus === 'offline') {
      setError('后端服务未启动，请先启动后端')
      return
    }

    setIsGenerating(true)
    setError(null)

    try {
      // 清除之前的分镜
      clearStoryboards()

      const results = await generateStoryboards({
        referenceImage: currentProject.referenceImage,
        storyText: currentProject.storyText,
        style: currentProject.style,
        count: storyboardCount
      })

      results.forEach((result) => {
        addStoryboard({
          id: result.id || Date.now().toString() + Math.random(),
          prompt: result.prompt,
          imageUrl: result.imageUrl,
          status: 'done'
        })
      })
    } catch (err) {
      console.error('生成失败:', err)
      setError('生成失败，请检查网络或后端服务')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = async (storyboardId: string, prompt: string) => {
    if (backendStatus === 'offline') return

    setRegeneratingId(storyboardId)
    updateStoryboard(storyboardId, { status: 'generating' })

    try {
      const newImageUrl = await regenerateImage(
        prompt,
        currentProject?.referenceImage || null,
        currentProject?.style || 'cinematic'
      )
      updateStoryboard(storyboardId, {
        imageUrl: newImageUrl,
        status: 'done'
      })
    } catch (err) {
      console.error('重新生成失败:', err)
      updateStoryboard(storyboardId, { status: 'error' })
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleExportAll = () => {
    if (!currentProject?.storyboards.length) return

    // 创建一个简单的 HTML 导出
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>分镜导出 - ${currentProject.name}</title>
  <style>
    body { font-family: sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .storyboard { display: flex; margin-bottom: 20px; border: 1px solid #ddd; }
    .storyboard img { width: 400px; height: auto; }
    .storyboard .info { padding: 20px; }
    .storyboard .index { font-size: 24px; font-weight: bold; color: #666; }
    .storyboard .prompt { margin-top: 10px; color: #333; }
  </style>
</head>
<body>
  <h1>${currentProject.name}</h1>
  <p>剧情：${currentProject.storyText}</p>
  <hr>
  ${currentProject.storyboards
    .map(
      (sb, i) => `
    <div class="storyboard">
      <img src="${sb.imageUrl}" alt="分镜 ${i + 1}">
      <div class="info">
        <div class="index">#${i + 1}</div>
        <div class="prompt">${sb.prompt}</div>
      </div>
    </div>
  `
    )
    .join('')}
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `storyboard-${Date.now()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadImage = (imageUrl: string, index: number) => {
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = `storyboard-${index + 1}.png`
    a.click()
  }

  if (!currentProject) return null

  return (
    <div className="flex h-full">
      {/* 左侧输入面板 */}
      <div className="w-80 bg-[#1a1a1a] p-4 border-r border-gray-800 flex flex-col gap-4 overflow-auto">
        {/* 后端状态 */}
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            backendStatus === 'online'
              ? 'bg-green-900/30 text-green-400'
              : backendStatus === 'offline'
                ? 'bg-red-900/30 text-red-400'
                : 'bg-gray-800 text-gray-400'
          }`}
        >
          {backendStatus === 'online' ? (
            <Check size={14} />
          ) : backendStatus === 'offline' ? (
            <X size={14} />
          ) : (
            <RefreshCw size={14} className="animate-spin" />
          )}
          <span>
            后端服务:{' '}
            {backendStatus === 'online'
              ? '已连接'
              : backendStatus === 'offline'
                ? '未连接'
                : '检查中...'}
          </span>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 text-red-400 rounded-lg text-sm">
            <AlertCircle size={14} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 参考图上传 */}
        <div>
          <label className="block text-sm font-medium mb-2">
            参考图（首帧）
          </label>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="aspect-video bg-[#252525] rounded-lg border-2 border-dashed border-gray-700 hover:border-primary/50 transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative"
          >
            {currentProject.referenceImage ? (
              <>
                <img
                  src={currentProject.referenceImage}
                  alt="参考图"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setReferenceImage('')}
                  className="absolute top-2 right-2 p-1 bg-black/60 rounded-lg hover:bg-red-600/80"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <label className="flex flex-col items-center cursor-pointer p-4">
                <Upload size={32} className="text-gray-500 mb-2" />
                <span className="text-sm text-gray-500">拖拽或点击上传</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        {/* 剧情输入 */}
        <div className="flex-1 flex flex-col">
          <label className="block text-sm font-medium mb-2">剧情描述</label>
          <textarea
            value={currentProject.storyText}
            onChange={(e) => setStoryText(e.target.value)}
            placeholder="输入故事梗概或场景描述...&#10;例如：主角走进房间，发现桌上有一封信"
            className="flex-1 min-h-[150px] bg-[#252525] rounded-lg p-3 text-sm resize-none border border-gray-700 focus:border-primary/50 focus:outline-none"
          />
          <div className="text-xs text-gray-500 mt-1 text-right">
            {currentProject.storyText.length} 字
          </div>
        </div>

        {/* 风格选择 */}
        <div>
          <label className="block text-sm font-medium mb-2">画面风格</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                  currentProject.style === s.id
                    ? 'bg-primary text-white'
                    : 'bg-[#252525] text-gray-400 hover:bg-[#303030]'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* 分镜数量 */}
        <div>
          <label className="block text-sm font-medium mb-2">
            分镜数量: {storyboardCount}
          </label>
          <input
            type="range"
            min={2}
            max={12}
            value={storyboardCount}
            onChange={(e) => setStoryboardCount(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={
            isGenerating ||
            !currentProject.storyText ||
            backendStatus === 'offline'
          }
          className="flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-primary to-secondary rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {isGenerating ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Wand2 size={18} />
              生成分镜
            </>
          )}
        </button>
      </div>

      {/* 右侧分镜展示区 */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            分镜画面
            {currentProject.storyboards.length > 0 && (
              <span className="text-sm text-gray-500 ml-2">
                ({currentProject.storyboards.length} 张)
              </span>
            )}
          </h2>
          {currentProject.storyboards.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={clearStoryboards}
                className="flex items-center gap-2 px-4 py-2 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors text-red-400"
              >
                <Trash2 size={16} />
                清空
              </button>
              <button
                onClick={handleExportAll}
                className="flex items-center gap-2 px-4 py-2 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors"
              >
                <Download size={16} />
                导出全部
              </button>
            </div>
          )}
        </div>

        {currentProject.storyboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500">
            <Film size={64} className="mb-4 opacity-30" />
            <p>还没有分镜画面</p>
            <p className="text-sm">输入剧情后点击生成</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {currentProject.storyboards.map((sb, index) => (
              <div
                key={sb.id}
                className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-gray-800 group"
              >
                <div className="aspect-video bg-[#252525] relative">
                  {sb.imageUrl && sb.status !== 'generating' ? (
                    <img
                      src={sb.imageUrl}
                      alt={`分镜 ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <RefreshCw
                        size={24}
                        className="text-gray-600 animate-spin"
                      />
                    </div>
                  )}
                  {/* 序号标签 */}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-xs font-medium">
                    #{index + 1}
                  </div>
                  {/* 操作按钮 */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownloadImage(sb.imageUrl!, index)}
                      className="p-1.5 bg-black/60 rounded-lg hover:bg-black/80"
                      title="下载"
                      disabled={!sb.imageUrl}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => handleRegenerate(sb.id, sb.prompt)}
                      className="p-1.5 bg-black/60 rounded-lg hover:bg-black/80"
                      title="重新生成"
                      disabled={regeneratingId === sb.id}
                    >
                      <RefreshCw
                        size={14}
                        className={
                          regeneratingId === sb.id ? 'animate-spin' : ''
                        }
                      />
                    </button>
                    <button
                      onClick={() => removeStoryboard(sb.id)}
                      className="p-1.5 bg-black/60 rounded-lg hover:bg-red-600/80"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-xs text-gray-400 line-clamp-2">
                    {sb.prompt}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
