import { useState, useEffect, useRef } from 'react'
import {
  Video,
  Upload,
  Wand2,
  Download,
  RefreshCw,
  Play,
  Pause,
  Trash2,
  Copy,
  Clock,
  Settings2,
  AlertCircle,
  Loader2,
  Film,
  Maximize2,
  Volume2,
  VolumeX,
  CheckCircle,
  Circle
} from 'lucide-react'
import ModuleChat from '../components/ModuleChat'
import ProjectBackButton from '../components/ProjectBackButton'
import {
  generateVideo,
  checkVideoTaskStatus,
  getVideoHistory,
  deleteVideoHistory
} from '../services/api'
import { useSettingsStore } from '../store/settingsStore'

// 统一的任务项类型
interface TaskItem {
  id: string
  type: 'current' | 'history'  // 当前会话 or 历史记录
  sourceImage: string
  prompt: string
  videoUrl: string | null
  taskId: string | null
  status: 'pending' | 'generating' | 'processing' | 'done' | 'error'
  progress: number
  duration: number
  motionStrength: number
  seed: number | null
  error?: string
  createdAt: string
  provider?: string
  model?: string
}

export default function VideoPage() {
  // 当前会话的任务
  const [currentTasks, setCurrentTasks] = useState<TaskItem[]>([])
  // 历史任务
  const [historyTasks, setHistoryTasks] = useState<TaskItem[]>([])
  // 选中的任务
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  // 设置面板
  const [showSettings, setShowSettings] = useState(false)
  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pollingRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  
  const { settings } = useSettingsStore()
  const isConfigured = settings.video.provider !== 'none' && settings.video.apiKey

  // 默认参数
  const [defaultDuration, setDefaultDuration] = useState(5)
  const [defaultMotionStrength, setDefaultMotionStrength] = useState(0.5)

  // 加载历史记录
  useEffect(() => {
    loadHistory()
    return () => {
      pollingRef.current.forEach(timer => clearTimeout(timer))
    }
  }, [])

  const loadHistory = async () => {
    try {
      const data = await getVideoHistory(50)
      const tasks: TaskItem[] = data.map(item => ({
        id: item.id,
        type: 'history',
        sourceImage: item.source_image || '',
        prompt: item.prompt || '',
        videoUrl: item.video_url,
        taskId: item.task_id,
        status: item.status === 'completed' ? 'done' : item.status === 'processing' ? 'processing' : 'error',
        progress: item.status === 'completed' ? 100 : 0,
        duration: item.duration || 5,
        motionStrength: 0.5,
        seed: item.seed,
        createdAt: item.created_at,
        provider: item.provider,
        model: item.model
      }))
      setHistoryTasks(tasks)
    } catch (error) {
      console.error('加载历史失败:', error)
    }
  }

  // 合并当前任务和历史任务
  const allTasks = [...currentTasks, ...historyTasks]

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const newTask: TaskItem = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type: 'current',
          sourceImage: event.target?.result as string,
          prompt: '',
          videoUrl: null,
          taskId: null,
          status: 'pending',
          progress: 0,
          duration: defaultDuration,
          motionStrength: defaultMotionStrength,
          seed: null,
          createdAt: new Date().toISOString()
        }
        setCurrentTasks(prev => [newTask, ...prev])
        setSelectedTask(newTask)
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  // 轮询任务状态
  const startPolling = (taskId: string, clipId: string) => {
    const poll = async () => {
      try {
        const result = await checkVideoTaskStatus(taskId)
        
        setCurrentTasks(prev => prev.map(t => {
          if (t.id === clipId) {
            if (result.status === 'completed') {
              const timer = pollingRef.current.get(clipId)
              if (timer) {
                clearTimeout(timer)
                pollingRef.current.delete(clipId)
              }
              loadHistory() // 刷新历史
              return { ...t, status: 'done' as const, videoUrl: result.videoUrl, progress: 100 }
            } else if (result.status === 'error') {
              const timer = pollingRef.current.get(clipId)
              if (timer) {
                clearTimeout(timer)
                pollingRef.current.delete(clipId)
              }
              return { ...t, status: 'error' as const, error: result.error || '生成失败', progress: 0 }
            } else {
              return { ...t, status: 'processing' as const, progress: result.progress || t.progress + 5 }
            }
          }
          return t
        }))
        
        // 更新选中任务
        if (selectedTask?.id === clipId) {
          setSelectedTask(prev => {
            if (!prev) return null
            if (result.status === 'completed') {
              return { ...prev, status: 'done', videoUrl: result.videoUrl, progress: 100 }
            } else if (result.status === 'error') {
              return { ...prev, status: 'error', error: result.error, progress: 0 }
            }
            return { ...prev, progress: result.progress || prev.progress + 5 }
          })
        }
        
        if (result.status !== 'completed' && result.status !== 'error') {
          const timer = setTimeout(poll, 3000)
          pollingRef.current.set(clipId, timer)
        }
      } catch (error) {
        console.error('轮询失败:', error)
        const timer = setTimeout(poll, 5000)
        pollingRef.current.set(clipId, timer)
      }
    }
    poll()
  }

  const handleGenerate = async (task: TaskItem) => {
    if (!isConfigured) {
      alert('请先在设置中配置视频生成 API')
      return
    }

    // 更新状态
    const updateTask = (updates: Partial<TaskItem>) => {
      setCurrentTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t))
      if (selectedTask?.id === task.id) {
        setSelectedTask(prev => prev ? { ...prev, ...updates } : null)
      }
    }

    updateTask({ status: 'generating', progress: 0, error: undefined })
    
    try {
      const result = await generateVideo(task.sourceImage, task.prompt, {
        duration: task.duration,
        motionStrength: task.motionStrength,
        seed: task.seed || undefined
      })
      
      if (result.status === 'completed' && result.videoUrl) {
        updateTask({ status: 'done', videoUrl: result.videoUrl, taskId: result.taskId, seed: result.seed, progress: 100 })
        loadHistory()
      } else if (result.status === 'processing' && result.taskId) {
        updateTask({ status: 'processing', taskId: result.taskId, seed: result.seed, progress: 10 })
        startPolling(result.taskId, task.id)
      } else if (result.status === 'error') {
        throw new Error(result.error || '生成失败')
      }
    } catch (error: any) {
      console.error('视频生成失败:', error)
      updateTask({ status: 'error', error: error.message || '生成失败' })
    }
  }

  const handleGenerateAll = () => {
    currentTasks.filter(t => t.status === 'pending' || t.status === 'error').forEach(task => {
      handleGenerate(task)
    })
  }

  const handleDeleteTask = async (task: TaskItem) => {
    // 停止轮询
    const timer = pollingRef.current.get(task.id)
    if (timer) {
      clearTimeout(timer)
      pollingRef.current.delete(task.id)
    }
    
    if (task.type === 'history') {
      try {
        await deleteVideoHistory(task.id)
        setHistoryTasks(prev => prev.filter(t => t.id !== task.id))
      } catch (err) {
        console.error('删除失败:', err)
      }
    } else {
      setCurrentTasks(prev => prev.filter(t => t.id !== task.id))
    }
    
    if (selectedTask?.id === task.id) {
      setSelectedTask(null)
    }
  }

  const handleCopyTask = (task: TaskItem) => {
    const newTask: TaskItem = {
      ...task,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      type: 'current',
      videoUrl: null,
      taskId: null,
      status: 'pending',
      progress: 0,
      error: undefined,
      createdAt: new Date().toISOString()
    }
    setCurrentTasks(prev => [newTask, ...prev])
    setSelectedTask(newTask)
  }

  const handleDownload = async (videoUrl: string, filename: string) => {
    try {
      const response = await fetch(videoUrl)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'video.mp4'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      window.open(videoUrl, '_blank')
    }
  }

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getStatusIcon = (status: TaskItem['status']) => {
    switch (status) {
      case 'done': return <CheckCircle size={14} className="text-green-400" />
      case 'generating':
      case 'processing': return <Loader2 size={14} className="text-yellow-400 animate-spin" />
      case 'error': return <AlertCircle size={14} className="text-red-400" />
      default: return <Circle size={14} className="text-gray-500" />
    }
  }

  const getStatusText = (status: TaskItem['status']) => {
    switch (status) {
      case 'done': return '已完成'
      case 'generating': return '提交中'
      case 'processing': return '生成中'
      case 'error': return '失败'
      default: return '待处理'
    }
  }

  const pendingCount = currentTasks.filter(t => t.status === 'pending' || t.status === 'error').length
  const processingCount = currentTasks.filter(t => t.status === 'generating' || t.status === 'processing').length

  return (
    <div className="flex flex-col h-full animate-fadeIn">
      {/* 项目返回按钮 */}
      <div className="px-4 pt-3">
        <ProjectBackButton />
      </div>
      
      <div className="flex-1 flex">
      {/* 左侧时间线 */}
      <div className="w-80 border-r border-white/5 flex flex-col glass-dark animate-slideInLeft">
        {/* 头部 */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Clock size={14} className="text-green-400" />
              任务时间线
            </h3>
            <span className="text-xs text-gray-500">{allTasks.length} 个任务</span>
          </div>
          <div className="flex gap-2">
            <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 glass-button rounded-xl text-xs cursor-pointer hover:bg-white/10 transition-all">
              <Upload size={14} />
              上传图片
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
            {pendingCount > 0 && (
              <button
                onClick={handleGenerateAll}
                disabled={processingCount > 0}
                className="px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                生成 ({pendingCount})
              </button>
            )}
          </div>
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-auto">
          {allTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
              <div className="w-16 h-16 rounded-2xl glass-card flex items-center justify-center mb-4">
                <Film size={24} className="text-gray-600" />
              </div>
              <p className="text-sm font-medium">暂无任务</p>
              <p className="text-xs text-gray-600 mt-1">上传图片开始生成视频</p>
            </div>
          ) : (
            <div className="p-3 space-y-1">
              {/* 当前会话任务 */}
              {currentTasks.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-gray-500 px-2 py-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    当前会话
                  </div>
                  {currentTasks.map((task, index) => (
                    <TaskTimelineItem
                      key={task.id}
                      task={task}
                      isSelected={selectedTask?.id === task.id}
                      isLast={index === currentTasks.length - 1}
                      onSelect={() => setSelectedTask(task)}
                      onDelete={() => handleDeleteTask(task)}
                      onCopy={() => handleCopyTask(task)}
                      formatTime={formatTime}
                      getStatusIcon={getStatusIcon}
                      getStatusText={getStatusText}
                    />
                  ))}
                </div>
              )}

              {/* 历史任务 */}
              {historyTasks.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 px-2 py-1 flex items-center gap-2">
                    <Clock size={10} />
                    历史记录
                  </div>
                  {historyTasks.map((task, index) => (
                    <TaskTimelineItem
                      key={task.id}
                      task={task}
                      isSelected={selectedTask?.id === task.id}
                      isLast={index === historyTasks.length - 1}
                      onSelect={() => setSelectedTask(task)}
                      onDelete={() => handleDeleteTask(task)}
                      onCopy={() => handleCopyTask(task)}
                      formatTime={formatTime}
                      getStatusIcon={getStatusIcon}
                      getStatusText={getStatusText}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 中间预览区 */}
      <div className="flex-1 flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-6 py-4 glass-dark border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500 via-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-green-500/30">
              <Video size={20} className="text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gradient">视频生成</h1>
              <p className="text-xs text-gray-500">
                {isConfigured ? `${settings.video.provider} - ${settings.video.model || '默认模型'}` : '未配置'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
                showSettings ? 'bg-green-500/20 text-green-400' : 'glass-button hover:bg-white/10'
              }`}
            >
              <Settings2 size={16} />
              参数
            </button>
          </div>
        </div>

        {/* 参数设置 */}
        {showSettings && (
          <div className="px-6 py-4 glass-dark border-b border-white/5 animate-fadeIn">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">默认时长</label>
                <select
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(Number(e.target.value))}
                  className="glass-input px-3 py-1.5 text-sm rounded-lg bg-gray-900/80"
                >
                  <option value={3} className="bg-gray-900">3 秒</option>
                  <option value={5} className="bg-gray-900">5 秒</option>
                  <option value={10} className="bg-gray-900">10 秒</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">运动强度</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={defaultMotionStrength}
                  onChange={(e) => setDefaultMotionStrength(Number(e.target.value))}
                  className="w-24 accent-green-500"
                />
                <span className="text-sm text-gray-300 w-8">{Math.round(defaultMotionStrength * 100)}%</span>
              </div>
              {!isConfigured && (
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <AlertCircle size={14} />
                  请先在设置中配置视频 API
                </div>
              )}
            </div>
          </div>
        )}

        {/* 预览区 */}
        <div className="flex-1 p-6 flex flex-col overflow-auto">
          {selectedTask ? (
            <>
              {/* 视频/图片预览 */}
              <div className="flex-1 flex items-center justify-center glass-card overflow-hidden rounded-2xl relative group">
                {selectedTask.videoUrl ? (
                  <>
                    <video
                      ref={videoRef}
                      src={selectedTask.videoUrl}
                      className="max-w-full max-h-full rounded-lg"
                      loop
                      muted={isMuted}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onClick={togglePlay}
                    />
                    <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={togglePlay} className="p-2 glass-button rounded-lg hover:bg-white/20">
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      </button>
                      <button onClick={() => setIsMuted(!isMuted)} className="p-2 glass-button rounded-lg hover:bg-white/20">
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => videoRef.current?.requestFullscreen?.()}
                        className="p-2 glass-button rounded-lg hover:bg-white/20"
                      >
                        <Maximize2 size={18} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="relative">
                    {selectedTask.sourceImage ? (
                      <img
                        src={selectedTask.sourceImage}
                        alt="源图片"
                        className="max-w-full max-h-[60vh] object-contain rounded-lg"
                      />
                    ) : (
                      <div className="w-64 h-64 flex items-center justify-center text-gray-500">
                        <Film size={48} />
                      </div>
                    )}
                    {(selectedTask.status === 'generating' || selectedTask.status === 'processing') && (
                      <div className="absolute inset-0 glass-dark rounded-lg flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-20 h-20 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                            <div className="relative">
                              <RefreshCw size={32} className="animate-spin text-green-400" />
                              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium">
                                {selectedTask.progress}%
                              </span>
                            </div>
                          </div>
                          <p className="text-sm mt-6">
                            {selectedTask.status === 'generating' ? '正在提交任务...' : '视频生成中...'}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">请耐心等待</p>
                        </div>
                      </div>
                    )}
                    {selectedTask.status === 'error' && (
                      <div className="absolute inset-0 glass-dark rounded-lg flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                            <AlertCircle size={28} className="text-red-400" />
                          </div>
                          <p className="text-sm text-red-400">生成失败</p>
                          <p className="text-xs text-gray-500 mt-1">{selectedTask.error || '请重试'}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 操作区 */}
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={selectedTask.prompt}
                    onChange={(e) => {
                      const newPrompt = e.target.value
                      if (selectedTask.type === 'current') {
                        setCurrentTasks(prev => prev.map(t => 
                          t.id === selectedTask.id ? { ...t, prompt: newPrompt } : t
                        ))
                      }
                      setSelectedTask(prev => prev ? { ...prev, prompt: newPrompt } : null)
                    }}
                    placeholder="输入运动描述（可选）：如 镜头缓慢推进，人物转身..."
                    className="flex-1 glass-input px-4 py-3 text-sm"
                    disabled={selectedTask.type === 'history'}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 glass-button px-3 py-2 rounded-xl">
                    <Clock size={14} className="text-gray-400" />
                    <select
                      value={selectedTask.duration}
                      onChange={(e) => {
                        const duration = Number(e.target.value)
                        if (selectedTask.type === 'current') {
                          setCurrentTasks(prev => prev.map(t => 
                            t.id === selectedTask.id ? { ...t, duration } : t
                          ))
                        }
                        setSelectedTask(prev => prev ? { ...prev, duration } : null)
                      }}
                      className="bg-transparent text-sm outline-none"
                      disabled={selectedTask.type === 'history' || selectedTask.status !== 'pending'}
                    >
                      <option value={3} className="bg-gray-900">3秒</option>
                      <option value={5} className="bg-gray-900">5秒</option>
                      <option value={10} className="bg-gray-900">10秒</option>
                    </select>
                  </div>

                  <div className="flex-1" />

                  <button
                    onClick={() => handleCopyTask(selectedTask)}
                    className="p-2.5 glass-button rounded-xl hover:bg-white/10"
                    title="复制任务"
                  >
                    <Copy size={16} />
                  </button>

                  {selectedTask.videoUrl && (
                    <button
                      onClick={() => handleDownload(selectedTask.videoUrl!, `video_${selectedTask.id}.mp4`)}
                      className="p-2.5 glass-button rounded-xl hover:bg-white/10"
                      title="下载视频"
                    >
                      <Download size={16} />
                    </button>
                  )}

                  {selectedTask.type === 'current' && (
                    <button
                      onClick={() => handleGenerate(selectedTask)}
                      disabled={selectedTask.status === 'generating' || selectedTask.status === 'processing'}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl font-medium disabled:opacity-50 hover:opacity-90 transition-all hover:scale-105 hover:shadow-lg hover:shadow-green-500/25"
                    >
                      {selectedTask.status === 'generating' || selectedTask.status === 'processing' ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          生成中...
                        </>
                      ) : selectedTask.status === 'done' ? (
                        <>
                          <RefreshCw size={16} />
                          重新生成
                        </>
                      ) : (
                        <>
                          <Wand2 size={16} />
                          生成视频
                        </>
                      )}
                    </button>
                  )}
                </div>

                {selectedTask.seed && (
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Seed: {selectedTask.seed}</span>
                    {selectedTask.taskId && <span>Task: {selectedTask.taskId}</span>}
                    {selectedTask.provider && <span>Provider: {selectedTask.provider}</span>}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
              <div className="w-24 h-24 rounded-3xl glass-card flex items-center justify-center mb-6">
                <Video size={40} className="text-gray-600" />
              </div>
              <p className="text-xl font-medium text-gray-400">选择任务或上传图片</p>
              <p className="text-sm text-gray-500 mt-2">从左侧时间线选择任务，或上传新图片</p>
              <label className="mt-6 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl font-medium cursor-pointer hover:opacity-90 transition-all hover:scale-105">
                <Upload size={18} />
                上传图片
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 右侧 AI 对话 */}
      <div className="w-96 border-l border-white/5 flex flex-col glass-dark animate-slideInRight">
        <ModuleChat 
          moduleType="video" 
          placeholder="描述视频效果，或让 AI 帮你规划运镜..."
          context={selectedTask?.prompt ? `当前运动描述：${selectedTask.prompt}` : undefined}
        />
      </div>
      </div>
    </div>
  )
}


// 时间线任务项组件
interface TaskTimelineItemProps {
  task: TaskItem
  isSelected: boolean
  isLast: boolean
  onSelect: () => void
  onDelete: () => void
  onCopy: () => void
  formatTime: (time: string) => string
  getStatusIcon: (status: TaskItem['status']) => React.ReactNode
  getStatusText: (status: TaskItem['status']) => string
}

function TaskTimelineItem({
  task,
  isSelected,
  isLast,
  onSelect,
  onDelete,
  onCopy,
  formatTime,
  getStatusIcon,
  getStatusText
}: TaskTimelineItemProps) {
  const [imgError, setImgError] = useState(false)
  
  return (
    <div className="relative flex group">
      {/* 时间线连接线 */}
      <div className="flex flex-col items-center mr-3">
        <div className={`w-3 h-3 rounded-full border-2 z-10 ${
          isSelected 
            ? 'border-green-400 bg-green-400' 
            : task.status === 'done' 
              ? 'border-green-500 bg-green-500/30'
              : task.status === 'error'
                ? 'border-red-500 bg-red-500/30'
                : task.status === 'generating' || task.status === 'processing'
                  ? 'border-yellow-500 bg-yellow-500/30'
                  : 'border-gray-500 bg-gray-500/30'
        }`} />
        {!isLast && (
          <div className={`w-0.5 flex-1 ${
            task.status === 'done' ? 'bg-green-500/30' : 'bg-gray-700'
          }`} />
        )}
      </div>

      {/* 任务卡片 */}
      <div
        onClick={onSelect}
        className={`flex-1 mb-2 p-2 rounded-xl cursor-pointer transition-all ${
          isSelected 
            ? 'glass-card ring-1 ring-green-500/50' 
            : 'hover:bg-white/5'
        }`}
      >
        <div className="flex items-start gap-2">
          {/* 缩略图 */}
          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0 relative">
            {task.videoUrl && task.status === 'done' ? (
              <video 
                src={task.videoUrl} 
                className="w-full h-full object-cover"
                muted
              />
            ) : task.sourceImage && !imgError ? (
              <img 
                src={task.sourceImage} 
                alt="" 
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film size={16} className="text-gray-600" />
              </div>
            )}
            {/* 状态覆盖层 */}
            {(task.status === 'generating' || task.status === 'processing') && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 size={14} className="animate-spin text-yellow-400" />
              </div>
            )}
          </div>

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {getStatusIcon(task.status)}
              <span className="text-xs text-gray-400">{getStatusText(task.status)}</span>
              {task.status === 'processing' && (
                <span className="text-xs text-yellow-400">{task.progress}%</span>
              )}
            </div>
            <p className="text-xs text-gray-300 truncate">
              {task.prompt || '无描述'}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {formatTime(task.createdAt)} · {task.duration}秒
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy() }}
              className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
              title="复制任务"
            >
              <Copy size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
