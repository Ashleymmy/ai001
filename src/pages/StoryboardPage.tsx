import { useState } from 'react'
import { Film, Wand2, Download, RefreshCw, Trash2 } from 'lucide-react'
import ModuleChat from '../components/ModuleChat'
import { generateStoryboards, regenerateImage } from '../services/api'

interface Storyboard {
  id: string
  index: number
  prompt: string
  imageUrl: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
}

const STYLES = [
  { id: 'cinematic', name: '电影感' },
  { id: 'anime', name: '动漫' },
  { id: 'realistic', name: '写实' },
  { id: 'ink', name: '水墨' }
]

export default function StoryboardPage() {
  const [script, setScript] = useState('')
  const [style, setStyle] = useState('cinematic')
  const [count, setCount] = useState(4)
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!script.trim()) return
    
    setIsGenerating(true)
    setStoryboards([])
    
    try {
      const results = await generateStoryboards({
        referenceImage: null,
        storyText: script,
        style,
        count
      })
      
      setStoryboards(results.map((r, i) => ({
        id: r.id,
        index: i + 1,
        prompt: r.prompt,
        imageUrl: r.imageUrl,
        status: 'done' as const
      })))
    } catch (error) {
      console.error('生成失败:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = async (sb: Storyboard) => {
    setRegeneratingId(sb.id)
    
    try {
      const newUrl = await regenerateImage(sb.prompt, null, style)
      setStoryboards(prev => prev.map(s => 
        s.id === sb.id ? { ...s, imageUrl: newUrl } : s
      ))
    } catch (error) {
      console.error('重新生成失败:', error)
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleDelete = (id: string) => {
    setStoryboards(prev => prev.filter(s => s.id !== id))
  }

  const handleExport = () => {
    // 导出为 HTML
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>分镜导出</title>
<style>body{font-family:sans-serif;max-width:1200px;margin:0 auto;padding:20px}
.sb{display:flex;margin-bottom:20px;border:1px solid #ddd;border-radius:8px;overflow:hidden}
.sb img{width:400px;height:auto}.sb .info{padding:20px}
.sb .idx{font-size:24px;font-weight:bold;color:#666}.sb .prompt{margin-top:10px}</style></head>
<body><h1>分镜脚本</h1><p>${script}</p><hr>
${storyboards.map(sb => `<div class="sb"><img src="${sb.imageUrl}"><div class="info"><div class="idx">#${sb.index}</div><div class="prompt">${sb.prompt}</div></div></div>`).join('')}
</body></html>`
    
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `storyboard-${Date.now()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full">
      {/* 左侧主区域 */}
      <div className="flex-1 flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-orange-400" />
            <h1 className="text-lg font-semibold">分镜制作</h1>
          </div>
          {storyboards.length > 0 && (
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors"
            >
              <Download size={16} />
              导出
            </button>
          )}
        </div>

        {/* 输入区 */}
        <div className="p-6 border-b border-gray-800 space-y-4">
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="输入剧本或场景描述...&#10;例如：主角走进一间昏暗的房间，发现桌上有一封信。他拿起信，脸上露出惊讶的表情。"
            className="w-full bg-[#1a1a1a] rounded-xl p-4 text-sm resize-none border border-gray-800 focus:border-primary/50 focus:outline-none h-28"
          />
          
          <div className="flex items-center gap-4">
            {/* 风格选择 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">风格:</span>
              <div className="flex gap-1">
                {STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                      style === s.id ? 'bg-primary text-white' : 'bg-[#252525] text-gray-400 hover:bg-[#303030]'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            
            {/* 数量选择 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">数量:</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="bg-[#252525] rounded-lg px-3 py-1 text-sm border border-gray-700"
              >
                {[2, 4, 6, 8, 10, 12].map(n => (
                  <option key={n} value={n}>{n} 张</option>
                ))}
              </select>
            </div>
            
            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !script.trim()}
              className="ml-auto flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
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
        </div>

        {/* 分镜展示区 */}
        <div className="flex-1 p-6 overflow-auto">
          {storyboards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Film size={64} className="mb-4 opacity-30" />
              <p>还没有分镜画面</p>
              <p className="text-sm">输入剧本后点击生成</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {storyboards.map((sb) => (
                <div
                  key={sb.id}
                  className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-gray-800 group"
                >
                  <div className="aspect-video bg-[#252525] relative">
                    {sb.imageUrl && regeneratingId !== sb.id ? (
                      <img
                        src={sb.imageUrl}
                        alt={`分镜 ${sb.index}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <RefreshCw size={24} className="text-gray-600 animate-spin" />
                      </div>
                    )}
                    
                    {/* 序号 */}
                    <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-xs font-medium">
                      #{sb.index}
                    </div>
                    
                    {/* 操作按钮 */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRegenerate(sb)}
                        disabled={regeneratingId === sb.id}
                        className="p-1.5 bg-black/60 rounded-lg hover:bg-black/80"
                        title="重新生成"
                      >
                        <RefreshCw size={14} className={regeneratingId === sb.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => handleDelete(sb.id)}
                        className="p-1.5 bg-black/60 rounded-lg hover:bg-red-600/80"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-3">
                    <p className="text-xs text-gray-400 line-clamp-2">{sb.prompt}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧 AI 对话 */}
      <div className="w-96 border-l border-gray-800 flex flex-col">
        <ModuleChat 
          moduleType="storyboard" 
          placeholder="描述场景，或让 AI 帮你设计分镜..."
          context={script ? `当前剧本：${script.slice(0, 300)}...` : undefined}
        />
      </div>
    </div>
  )
}
