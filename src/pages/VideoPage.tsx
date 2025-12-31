import { useState } from 'react'
import { Video, Upload, Wand2, Download, RefreshCw } from 'lucide-react'
import ModuleChat from '../components/ModuleChat'

interface VideoClip {
  id: string
  sourceImage: string
  prompt: string
  videoUrl: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
}

export default function VideoPage() {
  const [clips, setClips] = useState<VideoClip[]>([])
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const newClip: VideoClip = {
          id: Date.now().toString() + Math.random(),
          sourceImage: event.target?.result as string,
          prompt: '',
          videoUrl: null,
          status: 'pending'
        }
        setClips(prev => [...prev, newClip])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleGenerate = async (clip: VideoClip) => {
    setClips(prev => prev.map(c => 
      c.id === clip.id ? { ...c, status: 'generating' as const } : c
    ))
    
    // 模拟生成（实际调用视频生成 API）
    setTimeout(() => {
      setClips(prev => prev.map(c => 
        c.id === clip.id ? { 
          ...c, 
          status: 'done' as const,
          videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' // 示例视频
        } : c
      ))
    }, 3000)
  }

  const handleGenerateAll = () => {
    clips.filter(c => c.status === 'pending').forEach(clip => {
      handleGenerate(clip)
    })
  }

  return (
    <div className="flex h-full">
      {/* 左侧主区域 */}
      <div className="flex-1 flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Video size={20} className="text-green-400" />
            <h1 className="text-lg font-semibold">视频生成</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-3 py-1.5 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors cursor-pointer">
              <Upload size={16} />
              上传图片
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
            {clips.length > 0 && (
              <button
                onClick={handleGenerateAll}
                className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Wand2 size={16} />
                全部生成
              </button>
            )}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 flex">
          {/* 片段列表 */}
          <div className="w-64 border-r border-gray-800 p-4 overflow-auto">
            <h3 className="text-sm font-medium text-gray-400 mb-3">视频片段</h3>
            
            {clips.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                <p>上传分镜图片</p>
                <p>开始生成视频</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clips.map((clip, index) => (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClip(clip)}
                    className={`p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedClip?.id === clip.id 
                        ? 'bg-primary/20 border border-primary/50' 
                        : 'bg-[#1a1a1a] border border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={clip.sourceImage}
                        alt={`片段 ${index + 1}`}
                        className="w-12 h-12 rounded object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">片段 {index + 1}</p>
                        <p className="text-xs text-gray-500">
                          {clip.status === 'pending' && '待生成'}
                          {clip.status === 'generating' && '生成中...'}
                          {clip.status === 'done' && '已完成'}
                          {clip.status === 'error' && '失败'}
                        </p>
                      </div>
                      {clip.status === 'generating' && (
                        <RefreshCw size={14} className="animate-spin text-primary" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 预览区 */}
          <div className="flex-1 p-6 flex flex-col">
            {selectedClip ? (
              <>
                {/* 视频/图片预览 */}
                <div className="flex-1 flex items-center justify-center bg-[#1a1a1a] rounded-xl overflow-hidden">
                  {selectedClip.videoUrl ? (
                    <video
                      src={selectedClip.videoUrl}
                      controls
                      className="max-w-full max-h-full"
                    />
                  ) : (
                    <div className="relative">
                      <img
                        src={selectedClip.sourceImage}
                        alt="源图片"
                        className="max-w-full max-h-[60vh] object-contain"
                      />
                      {selectedClip.status === 'generating' && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="text-center">
                            <RefreshCw size={32} className="animate-spin mx-auto mb-2" />
                            <p>视频生成中...</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 操作区 */}
                <div className="mt-4 flex items-center gap-4">
                  <input
                    type="text"
                    value={selectedClip.prompt}
                    onChange={(e) => {
                      setClips(prev => prev.map(c => 
                        c.id === selectedClip.id ? { ...c, prompt: e.target.value } : c
                      ))
                      setSelectedClip(prev => prev ? { ...prev, prompt: e.target.value } : null)
                    }}
                    placeholder="输入运动描述（可选）：如 镜头缓慢推进，人物转身..."
                    className="flex-1 bg-[#1a1a1a] rounded-lg px-4 py-2 text-sm border border-gray-800 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    onClick={() => handleGenerate(selectedClip)}
                    disabled={selectedClip.status === 'generating'}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    {selectedClip.status === 'generating' ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Wand2 size={16} />
                    )}
                    生成视频
                  </button>
                  {selectedClip.videoUrl && (
                    <button className="p-2 bg-[#252525] rounded-lg hover:bg-[#303030]">
                      <Download size={18} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                <Video size={64} className="mb-4 opacity-30" />
                <p>选择或上传图片开始生成视频</p>
                <p className="text-sm mt-1">支持将分镜图片转换为动态视频</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧 AI 对话 */}
      <div className="w-96 border-l border-gray-800 flex flex-col">
        <ModuleChat 
          moduleType="video" 
          placeholder="描述视频效果，或让 AI 帮你规划运镜..."
          context={selectedClip?.prompt ? `当前运动描述：${selectedClip.prompt}` : undefined}
        />
      </div>
    </div>
  )
}
