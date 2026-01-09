import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { 
  Send, Square, ChevronDown, Bot, Check, Plus, X,
  FileText, Image as ImageIcon, File, Film, Music, Code, FileSpreadsheet
} from 'lucide-react'
import { useSettingsStore, LLM_PROVIDERS } from '../store/settingsStore'
import { uploadFile } from '../services/api'

// 文件类型配置
const FILE_CATEGORIES = [
  {
    id: 'image',
    name: '图片',
    icon: ImageIcon,
    color: 'from-pink-500 to-rose-500',
    accept: 'image/*',
    maxSize: 20 * 1024 * 1024,
    description: 'JPG, PNG, GIF, WebP'
  },
  {
    id: 'document',
    name: '文档',
    icon: FileText,
    color: 'from-blue-500 to-cyan-500',
    accept: '.pdf,.doc,.docx,.txt,.md',
    maxSize: 50 * 1024 * 1024,
    description: 'PDF, Word, TXT, MD'
  },
  {
    id: 'spreadsheet',
    name: '表格',
    icon: FileSpreadsheet,
    color: 'from-green-500 to-emerald-500',
    accept: '.csv,.xlsx,.xls',
    maxSize: 30 * 1024 * 1024,
    description: 'CSV, Excel'
  },
  {
    id: 'code',
    name: '代码',
    icon: Code,
    color: 'from-violet-500 to-purple-500',
    accept: '.py,.js,.ts,.jsx,.tsx,.html,.css,.json,.xml,.yaml,.yml,.sql,.java,.cpp,.c,.go,.rs',
    maxSize: 10 * 1024 * 1024,
    description: 'Python, JS, TS 等'
  },
  {
    id: 'video',
    name: '视频',
    icon: Film,
    color: 'from-orange-500 to-amber-500',
    accept: 'video/*',
    maxSize: 100 * 1024 * 1024,
    description: 'MP4, WebM, MOV'
  },
  {
    id: 'audio',
    name: '音频',
    icon: Music,
    color: 'from-teal-500 to-cyan-500',
    accept: 'audio/*',
    maxSize: 25 * 1024 * 1024,
    description: 'MP3, WAV, M4A'
  },
]

export interface UploadedFile {
  id: string
  name: string
  type: string
  mimeType: string
  size: number
  dataUrl?: string
  content?: string
  url?: string
  file: File
  uploading?: boolean
  error?: string
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading: boolean
  placeholder?: string
  rows?: number
  showModelSelector?: boolean
  enableFileUpload?: boolean
  uploadedFiles?: UploadedFile[]
  onFilesChange?: (files: UploadedFile[]) => void
  maxFiles?: number
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading,
  placeholder = '输入消息...',
  rows = 3,
  showModelSelector = true,
  enableFileUpload = true,
  uploadedFiles = [],
  onFilesChange,
  maxFiles = 10
}: ChatInputProps) {
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showUploadMenu, setShowUploadMenu] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadMenuPos, setUploadMenuPos] = useState({ x: 0, y: 0 })
  const [modelMenuPos, setModelMenuPos] = useState({ x: 0, y: 0 })
  
  const uploadBtnRef = useRef<HTMLButtonElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [currentAccept, setCurrentAccept] = useState('')
  
  const { settings, updateLLM } = useSettingsStore()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading && (value.trim() || uploadedFiles.length > 0)) onSend()
    }
  }

  const toggleUploadMenu = () => {
    if (!showUploadMenu && uploadBtnRef.current) {
      const rect = uploadBtnRef.current.getBoundingClientRect()
      setUploadMenuPos({ x: rect.left, y: rect.top - 8 })
    }
    setShowUploadMenu(!showUploadMenu)
    setShowModelMenu(false)
  }

  const toggleModelMenu = () => {
    if (!showModelMenu && modelBtnRef.current) {
      const rect = modelBtnRef.current.getBoundingClientRect()
      setModelMenuPos({ x: rect.left, y: rect.top - 8 })
    }
    setShowModelMenu(!showModelMenu)
    setShowUploadMenu(false)
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || !onFilesChange) return

    const newFiles: UploadedFile[] = []
    
    for (let i = 0; i < files.length && uploadedFiles.length + newFiles.length < maxFiles; i++) {
      const file = files[i]
      const tempId = `temp_${Date.now()}_${i}`
      
      // 先创建临时文件对象显示预览
      const tempFile: UploadedFile = {
        id: tempId,
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 
              file.type.startsWith('video/') ? 'video' :
              file.type.startsWith('audio/') ? 'audio' : 'document',
        mimeType: file.type,
        size: file.size,
        file,
        uploading: true
      }
      
      // 图片预览
      if (file.type.startsWith('image/')) {
        tempFile.dataUrl = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }
      
      newFiles.push(tempFile)
    }
    
    // 先显示上传中的文件
    onFilesChange([...uploadedFiles, ...newFiles])
    
    // 逐个上传文件
    const uploadedResults: UploadedFile[] = [...uploadedFiles]
    
    for (const tempFile of newFiles) {
      try {
        const result = await uploadFile(tempFile.file)
        
        // 更新为上传成功的文件
        const uploadedFile: UploadedFile = {
          id: result.file.id,
          name: result.file.name,
          type: result.file.category,
          mimeType: result.file.type,
          size: result.file.size,
          url: result.file.url,
          dataUrl: result.file.previewUrl || tempFile.dataUrl,
          content: result.file.content,
          file: tempFile.file,
          uploading: false
        }
        uploadedResults.push(uploadedFile)
      } catch (error) {
        console.error('上传失败:', error)
        // 标记为上传失败
        uploadedResults.push({
          ...tempFile,
          uploading: false,
          error: '上传失败'
        })
      }
    }
    
    onFilesChange(uploadedResults)
    setShowUploadMenu(false)
  }

  const handleSelectCategory = (category: typeof FILE_CATEGORIES[0]) => {
    setCurrentAccept(category.accept)
    setShowUploadMenu(false)
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  const handleRemoveFile = (fileId: string) => {
    onFilesChange?.(uploadedFiles.filter(f => f.id !== fileId))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (enableFileUpload) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (enableFileUpload) handleFileSelect(e.dataTransfer.files)
  }

  const getFileIcon = (type: string) => {
    const icons: Record<string, typeof File> = {
      image: ImageIcon, video: Film, audio: Music, document: FileText
    }
    const Icon = icons[type] || File
    return <Icon size={14} />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  }

  const getCurrentModelName = () => {
    const provider = LLM_PROVIDERS.find(p => p.id === settings.llm.provider)
    return `${provider?.name || settings.llm.provider} / ${settings.llm.model || '默认'}`
  }

  const getAvailableModels = () => {
    const models: { provider: string; providerName: string; model: string }[] = []
    LLM_PROVIDERS.forEach(provider => {
      if (provider.id === 'custom') return
      if (provider.models.length > 0) {
        provider.models.forEach(model => {
          models.push({ provider: provider.id, providerName: provider.name, model })
        })
      } else if (provider.id === 'doubao' && settings.llm.provider === 'doubao' && settings.llm.model) {
        models.push({ provider: 'doubao', providerName: '豆包(字节)', model: settings.llm.model })
      }
    })
    return models
  }

  const handleSelectModel = (provider: string, model: string) => {
    const providerConfig = LLM_PROVIDERS.find(p => p.id === provider)
    updateLLM({ provider, model, baseUrl: providerConfig?.baseUrl || settings.llm.baseUrl })
    setShowModelMenu(false)
  }

  // 上传菜单 Portal
  const uploadMenuPortal = showUploadMenu && createPortal(
    <div 
      className="fixed z-[99999]"
      style={{ left: uploadMenuPos.x, top: uploadMenuPos.y, transform: 'translateY(-100%)' }}
    >
      <div 
        className="w-52 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-white/10 bg-white/5">
          <p className="text-xs text-gray-400 font-medium">选择文件类型</p>
        </div>
        <div className="py-1">
          {FILE_CATEGORIES.map(category => {
            const Icon = category.icon
            return (
              <button
                key={category.id}
                onClick={() => handleSelectCategory(category)}
                className="w-full px-3 py-2 flex items-center gap-3 hover:bg-white/10 transition-colors text-left"
              >
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${category.color} flex items-center justify-center`}>
                  <Icon size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{category.name}</p>
                  <p className="text-[10px] text-gray-500">{category.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="fixed inset-0 -z-10" onClick={() => setShowUploadMenu(false)} />
    </div>,
    document.body
  )

  // 模型菜单 Portal
  const modelMenuPortal = showModelMenu && createPortal(
    <div 
      className="fixed z-[99999]"
      style={{ left: modelMenuPos.x, top: modelMenuPos.y, transform: 'translateY(-100%)' }}
    >
      <div 
        className="w-72 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 overflow-hidden max-h-80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-white/10 bg-white/5">
          <p className="text-xs text-gray-400 font-medium">选择模型</p>
        </div>
        <div className="py-1 max-h-60 overflow-y-auto">
          {getAvailableModels().map((item, index) => {
            const isSelected = settings.llm.provider === item.provider && settings.llm.model === item.model
            return (
              <button
                key={`${item.provider}-${item.model}-${index}`}
                onClick={() => handleSelectModel(item.provider, item.model)}
                className={`w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 flex items-center justify-between transition-colors ${isSelected ? 'bg-white/10' : ''}`}
              >
                <div>
                  <span className="text-gray-400">{item.providerName}</span>
                  <span className="mx-2 text-gray-600">/</span>
                  <span className="text-white">{item.model}</span>
                </div>
                {isSelected && <Check size={14} className="text-primary" />}
              </button>
            )
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10 bg-white/5">
          <p className="text-xs text-gray-600">在设置页面配置更多模型</p>
        </div>
      </div>
      <div className="fixed inset-0 -z-10" onClick={() => setShowModelMenu(false)} />
    </div>,
    document.body
  )

  return (
    <>
      <div 
        className="relative"
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽提示 */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-2xl backdrop-blur-sm">
            <div className="text-center">
              <Plus size={24} className="mx-auto mb-2 text-primary" />
              <p className="text-sm text-primary font-medium">释放以上传文件</p>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={currentAccept}
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />

        <div className="glass-card rounded-2xl">
          {/* 已上传文件 */}
          {uploadedFiles.length > 0 && (
            <div className="px-4 pt-3 pb-2 border-b border-white/5">
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map(file => (
                  <div key={file.id} className="group relative flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all">
                    {file.type === 'image' && file.dataUrl ? (
                      <img src={file.dataUrl} alt={file.name} className="w-8 h-8 rounded-lg object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-500 to-gray-600 flex items-center justify-center">
                        {getFileIcon(file.type)}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs font-medium max-w-[100px] truncate">{file.name}</span>
                      <span className="text-[10px] text-gray-500">{formatFileSize(file.size)}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(file.id)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 输入框 */}
          <div className="p-3">
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder-gray-500"
              rows={rows}
              disabled={isLoading}
            />
          </div>

          {/* 工具栏 */}
          <div className="px-3 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {enableFileUpload && (
                <button
                  ref={uploadBtnRef}
                  onClick={toggleUploadMenu}
                  disabled={isLoading || uploadedFiles.length >= maxFiles}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${showUploadMenu ? 'bg-primary/20 text-primary' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'} disabled:opacity-40`}
                  title="上传文件"
                >
                  <Plus size={16} />
                </button>
              )}

              {showModelSelector && (
                <button
                  ref={modelBtnRef}
                  onClick={toggleModelMenu}
                  className={`h-8 px-3 rounded-xl flex items-center gap-2 text-xs transition-all ${showModelMenu ? 'bg-primary/20 text-primary' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'}`}
                >
                  <Bot size={14} />
                  <span className="max-w-[120px] truncate hidden sm:inline">{getCurrentModelName()}</span>
                  <ChevronDown size={12} className={`transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isLoading ? (
                <button
                  onClick={onStop}
                  className="h-8 px-4 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30 flex items-center gap-2 text-sm border border-red-500/30"
                >
                  <Square size={12} fill="currentColor" />
                  <span className="hidden sm:inline">停止</span>
                </button>
              ) : (
                <button
                  onClick={onSend}
                  disabled={!value.trim() && uploadedFiles.length === 0}
                  className="h-8 px-4 bg-gradient-to-r from-primary to-purple-500 text-white rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium shadow-lg shadow-primary/25"
                >
                  <Send size={14} />
                  <span className="hidden sm:inline">发送</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {uploadMenuPortal}
      {modelMenuPortal}
    </>
  )
}
