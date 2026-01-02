import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Plus, Type, Image as ImageIcon, Video, FileText, Music,
  Upload, Download, Sparkles, ZoomIn, ZoomOut,
  X, Play, Trash2, Copy, ChevronLeft, Save,
  Undo2, Redo2, Grid, RotateCcw, EyeOff, Lock, Unlock,
  ChevronDown, Check, Loader2, AlertCircle
} from 'lucide-react'
import { generateImage, chatWithAI } from '../services/api'
import { useSettingsStore } from '../store/settingsStore'

// 节点类型
type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script'

// 节点接口
interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  title: string
  content: string
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  status: 'idle' | 'generating' | 'done' | 'error'
  error?: string
  locked: boolean
  visible: boolean
  zIndex: number
  // 生成参数
  model?: string
  style?: string
  seed?: number
}

// 连接接口
interface Connection {
  id: string
  fromNode: string
  fromPort: 'output'
  toNode: string
  toPort: 'input'
}

// 历史记录
interface HistoryState {
  nodes: CanvasNode[]
  connections: Connection[]
}

// 模板
const TEMPLATES = [
  { id: 'empty', name: '空白画布', desc: '从零开始', nodes: [] },
  { id: 'story', name: '故事创作', desc: '剧本→分镜→视频', nodes: ['script', 'image', 'video'] },
  { id: 'ad', name: '广告制作', desc: '文案→图片→配音', nodes: ['text', 'image', 'audio'] },
  { id: 'music-video', name: 'MV制作', desc: '歌词→画面→视频', nodes: ['text', 'image', 'video', 'audio'] },
]

// 节点类型配置
const NODE_TYPES = [
  { type: 'text' as NodeType, icon: Type, label: '文本', desc: '故事、文案、提示词', gradient: 'from-blue-500 to-cyan-500' },
  { type: 'image' as NodeType, icon: ImageIcon, label: '图片', desc: 'AI 图像生成', gradient: 'from-purple-500 to-pink-500' },
  { type: 'video' as NodeType, icon: Video, label: '视频', desc: '图生视频', gradient: 'from-green-500 to-emerald-500' },
  { type: 'audio' as NodeType, icon: Music, label: '音频', desc: '配音、音乐', gradient: 'from-orange-500 to-amber-500' },
  { type: 'script' as NodeType, icon: FileText, label: '剧本', desc: 'AI 剧本创作', gradient: 'from-violet-500 to-purple-500' },
]

export default function CanvasPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const urlProjectId = location.pathname.match(/\/canvas\/([^/]+)/)?.[1] || null
  
  const { settings } = useSettingsStore()
  
  // 画布状态
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  const [canvasName, setCanvasName] = useState('未命名画布')
  const [canvasId, setCanvasId] = useState<string | null>(null)
  
  // 视图状态
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  
  // 交互状态
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [connectingPos, setConnectingPos] = useState({ x: 0, y: 0 })
  
  // UI 状态
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [addMenuPos, setAddMenuPos] = useState({ x: 0, y: 0 })
  const [showTemplates, setShowTemplates] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  
  // 历史记录
  const [history, setHistory] = useState<HistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const maxHistory = 50
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const panStart = useRef({ x: 0, y: 0 })
  const nextZIndex = useRef(1)

  // 保存历史
  const saveHistory = useCallback(() => {
    const state: HistoryState = { nodes: [...nodes], connections: [...connections] }
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(state)
      if (newHistory.length > maxHistory) newHistory.shift()
      return newHistory
    })
    setHistoryIndex(prev => Math.min(prev + 1, maxHistory - 1))
  }, [nodes, connections, historyIndex])

  // 撤销
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1]
      setNodes(prevState.nodes)
      setConnections(prevState.connections)
      setHistoryIndex(prev => prev - 1)
    }
  }, [history, historyIndex])

  // 重做
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1]
      setNodes(nextState.nodes)
      setConnections(nextState.connections)
      setHistoryIndex(prev => prev + 1)
    }
  }, [history, historyIndex])

  // 标记未保存
  useEffect(() => {
    if (nodes.length > 0 || canvasName !== '未命名画布') {
      setHasUnsavedChanges(true)
    }
  }, [nodes, connections, canvasName])

  // 保存画布
  const handleSave = useCallback((showAlert = true) => {
    const data = {
      id: canvasId || `canvas-${Date.now()}`,
      name: canvasName,
      nodes, connections, zoom, pan,
      updatedAt: new Date().toISOString()
    }
    const saved = JSON.parse(localStorage.getItem('storyboarder-canvases') || '[]')
    const idx = saved.findIndex((c: { id: string }) => c.id === data.id)
    if (idx >= 0) saved[idx] = data
    else { saved.unshift(data); setCanvasId(data.id) }
    localStorage.setItem('storyboarder-canvases', JSON.stringify(saved))
    setHasUnsavedChanges(false)
    if (showAlert) alert('保存成功')
  }, [canvasId, canvasName, nodes, connections, zoom, pan])

  // 导航
  const getBackTarget = () => urlProjectId ? `/project/${urlProjectId}` : '/'
  const handleBack = () => hasUnsavedChanges ? setShowExitDialog(true) : navigate(getBackTarget())
  const handleSaveAndExit = () => { handleSave(false); navigate(getBackTarget()) }
  const handleExitWithoutSave = () => navigate(getBackTarget())

  // 创建节点
  const createNode = useCallback((type: NodeType, x?: number, y?: number) => {
    const config = NODE_TYPES.find(t => t.type === type)!
    const newNode: CanvasNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      x: x ?? (canvasRef.current ? canvasRef.current.clientWidth / 2 / zoom - pan.x / zoom - 150 : 200),
      y: y ?? (canvasRef.current ? canvasRef.current.clientHeight / 2 / zoom - pan.y / zoom - 100 : 200),
      width: type === 'text' || type === 'script' ? 320 : 300,
      height: type === 'text' || type === 'script' ? 200 : 280,
      title: config.label,
      content: '',
      status: 'idle',
      locked: false,
      visible: true,
      zIndex: nextZIndex.current++
    }
    setNodes(prev => [...prev, newNode])
    setSelectedNodes(new Set([newNode.id]))
    setShowAddMenu(false)
    saveHistory()
    return newNode
  }, [zoom, pan, saveHistory])

  // 删除节点
  const deleteNode = useCallback((id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id))
    setConnections(prev => prev.filter(c => c.fromNode !== id && c.toNode !== id))
    setSelectedNodes(prev => { prev.delete(id); return new Set(prev) })
    saveHistory()
  }, [saveHistory])

  // 复制节点
  const duplicateNode = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    const newNode: CanvasNode = {
      ...node,
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: node.x + 30,
      y: node.y + 30,
      zIndex: nextZIndex.current++
    }
    setNodes(prev => [...prev, newNode])
    setSelectedNodes(new Set([newNode.id]))
    saveHistory()
  }, [nodes, saveHistory])

  // 更新节点
  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n))
  }, [])

  // 创建连接
  const createConnection = useCallback((fromNode: string, toNode: string) => {
    if (fromNode === toNode) return
    const exists = connections.some(c => c.fromNode === fromNode && c.toNode === toNode)
    if (exists) return
    const conn: Connection = {
      id: `conn-${Date.now()}`,
      fromNode, fromPort: 'output',
      toNode, toPort: 'input'
    }
    setConnections(prev => [...prev, conn])
    saveHistory()
  }, [connections, saveHistory])

  // 删除连接
  const deleteConnection = useCallback((id: string) => {
    setConnections(prev => prev.filter(c => c.id !== id))
    saveHistory()
  }, [saveHistory])

  // AI 生成
  const generateContent = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node || !node.content.trim()) return

    updateNode(nodeId, { status: 'generating', error: undefined })

    try {
      if (node.type === 'image') {
        const result = await generateImage(
          node.content,
          undefined,
          { width: 1024, height: 1024, style: node.style }
        )
        if (result.imageUrl) {
          updateNode(nodeId, { status: 'done', imageUrl: result.imageUrl, seed: result.seed })
        } else {
          throw new Error('生成失败')
        }
      } else if (node.type === 'text' || node.type === 'script') {
        const systemPrompt = node.type === 'script' 
          ? '你是专业的剧本创作助手，请根据用户的描述创作剧本内容。'
          : '你是创意文案助手，请根据用户的描述生成文案内容。'
        
        const result = await chatWithAI(node.content, systemPrompt)
        updateNode(nodeId, { status: 'done', content: result })
      } else {
        // video/audio 暂时模拟
        await new Promise(r => setTimeout(r, 2000))
        updateNode(nodeId, { status: 'done' })
      }
    } catch (err: any) {
      updateNode(nodeId, { status: 'error', error: err.message || '生成失败' })
    }
  }, [nodes, updateNode])

  // 执行工作流
  const executeWorkflow = useCallback(async () => {
    // 按连接顺序执行
    const executed = new Set<string>()
    const queue = nodes.filter(n => !connections.some(c => c.toNode === n.id)).map(n => n.id)
    
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (executed.has(nodeId)) continue
      
      const node = nodes.find(n => n.id === nodeId)
      if (node && node.content && node.status !== 'done') {
        await generateContent(nodeId)
      }
      executed.add(nodeId)
      
      // 添加下游节点
      connections.filter(c => c.fromNode === nodeId).forEach(c => {
        if (!executed.has(c.toNode)) queue.push(c.toNode)
      })
    }
  }, [nodes, connections, generateContent])

  // 加载模板
  const loadTemplate = useCallback((templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId)
    if (!template) return
    
    setNodes([])
    setConnections([])
    
    if (template.nodes.length > 0) {
      const newNodes: CanvasNode[] = []
      const newConns: Connection[] = []
      
      template.nodes.forEach((type, i) => {
        const config = NODE_TYPES.find(t => t.type === type)!
        newNodes.push({
          id: `node-${Date.now()}-${i}`,
          type: type as NodeType,
          x: 150 + i * 350,
          y: 200,
          width: 300,
          height: 250,
          title: config.label,
          content: '',
          status: 'idle',
          locked: false,
          visible: true,
          zIndex: i + 1
        })
      })
      
      // 创建连接
      for (let i = 0; i < newNodes.length - 1; i++) {
        newConns.push({
          id: `conn-${Date.now()}-${i}`,
          fromNode: newNodes[i].id,
          fromPort: 'output',
          toNode: newNodes[i + 1].id,
          toPort: 'input'
        })
      }
      
      setNodes(newNodes)
      setConnections(newConns)
      nextZIndex.current = newNodes.length + 1
    }
    
    setShowTemplates(false)
    saveHistory()
  }, [saveHistory])

  // 鼠标事件
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('canvas-bg')) {
      setSelectedNodes(new Set())
      setIsPanning(true)
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    }
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('canvas-bg')) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        setAddMenuPos({ x: e.clientX, y: e.clientY })
        setShowAddMenu(true)
      }
    }
  }

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    const node = nodes.find(n => n.id === nodeId)
    if (!node || node.locked) return
    
    setDraggingNode(nodeId)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      setDragOffset({
        x: (e.clientX - rect.left - pan.x) / zoom - node.x,
        y: (e.clientY - rect.top - pan.y) / zoom - node.y
      })
    }
    
    if (!e.shiftKey) {
      setSelectedNodes(new Set([nodeId]))
    } else {
      setSelectedNodes(prev => { prev.add(nodeId); return new Set(prev) })
    }
    
    // 提升层级
    updateNode(nodeId, { zIndex: nextZIndex.current++ })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    if (draggingNode) {
      const x = (e.clientX - rect.left - pan.x) / zoom - dragOffset.x
      const y = (e.clientY - rect.top - pan.y) / zoom - dragOffset.y
      updateNode(draggingNode, { x, y })
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y })
    } else if (connectingFrom) {
      setConnectingPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }, [draggingNode, isPanning, connectingFrom, zoom, pan, dragOffset, updateNode])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (draggingNode) {
      saveHistory()
    }
    setDraggingNode(null)
    setIsPanning(false)
    setConnectingFrom(null)
  }, [draggingNode, saveHistory])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // 滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(prev => Math.min(Math.max(prev * delta, 0.25), 3))
    }
  }

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave(true)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        selectedNodes.forEach(id => deleteNode(id))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, handleSave, selectedNodes, deleteNode])

  // 导出
  const handleExport = useCallback(() => {
    const data = { name: canvasName, nodes, connections, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${canvasName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [canvasName, nodes, connections])

  // 获取节点位置（用于连线）
  const getNodePortPos = (nodeId: string, port: 'input' | 'output') => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    return {
      x: port === 'input' ? node.x : node.x + node.width,
      y: node.y + node.height / 2
    }
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#0a0a12]">
      {/* 退出确认 */}
      {showExitDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card p-6 rounded-2xl w-96 animate-scaleIn">
            <h3 className="text-lg font-semibold mb-2">保存画布？</h3>
            <p className="text-sm text-gray-400 mb-6">你有未保存的更改</p>
            <div className="flex gap-3">
              <button onClick={handleExitWithoutSave} className="flex-1 py-2.5 glass-button rounded-xl text-sm">不保存</button>
              <button onClick={() => setShowExitDialog(false)} className="flex-1 py-2.5 glass-button rounded-xl text-sm">取消</button>
              <button onClick={handleSaveAndExit} className="flex-1 py-2.5 bg-primary rounded-xl text-sm font-medium">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 模板选择 */}
      {showTemplates && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card p-6 rounded-2xl w-[500px] animate-scaleIn">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">选择模板</h3>
              <button onClick={() => setShowTemplates(false)} className="p-2 hover:bg-white/10 rounded-lg"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => loadTemplate(t.id)}
                  className="p-4 glass-card rounded-xl text-left hover:ring-2 hover:ring-primary transition-all"
                >
                  <h4 className="font-medium mb-1">{t.name}</h4>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                  {t.nodes.length > 0 && (
                    <div className="flex gap-1 mt-3">
                      {t.nodes.map((type, i) => {
                        const config = NODE_TYPES.find(n => n.type === type)
                        return config ? <config.icon key={i} size={14} className="text-gray-400" /> : null
                      })}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 左侧工具栏 */}
      <aside className="w-14 glass-dark flex flex-col items-center py-4 border-r border-white/5 z-20">
        <button onClick={handleBack} className="p-3 rounded-xl mb-2 text-gray-400 hover:text-white glass-button" title={urlProjectId ? "返回项目" : "返回首页"}>
          <ChevronLeft size={20} />
        </button>
        
        <button onClick={() => setShowAddMenu(!showAddMenu)} className="p-3 rounded-xl bg-primary text-white mb-3 shadow-lg" title="添加节点">
          <Plus size={20} />
        </button>
        
        <div className="w-8 h-px bg-white/10 my-2" />
        
        <button onClick={undo} disabled={historyIndex <= 0} className="p-2.5 rounded-xl text-gray-400 hover:text-white disabled:opacity-30 mb-1" title="撤销 Ctrl+Z">
          <Undo2 size={18} />
        </button>
        <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-2.5 rounded-xl text-gray-400 hover:text-white disabled:opacity-30 mb-1" title="重做 Ctrl+Shift+Z">
          <Redo2 size={18} />
        </button>
        
        <div className="w-8 h-px bg-white/10 my-2" />
        
        <button onClick={() => setShowGrid(!showGrid)} className={`p-2.5 rounded-xl mb-1 ${showGrid ? 'text-primary' : 'text-gray-400 hover:text-white'}`} title="网格">
          <Grid size={18} />
        </button>
        <button onClick={() => setShowTemplates(true)} className="p-2.5 rounded-xl text-gray-400 hover:text-white mb-1" title="模板">
          <FileText size={18} />
        </button>
        
        <div className="flex-1" />
        
        <button onClick={() => handleSave(true)} className={`p-2.5 rounded-xl mb-1 ${hasUnsavedChanges ? 'text-primary' : 'text-gray-400 hover:text-white'}`} title="保存 Ctrl+S">
          <Save size={18} />
        </button>
        <button onClick={handleExport} className="p-2.5 rounded-xl text-gray-400 hover:text-white" title="导出">
          <Download size={18} />
        </button>
      </aside>

      {/* 主画布 */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* 顶部栏 */}
        <header className="h-12 px-4 flex items-center justify-between border-b border-white/5 glass-dark z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500" />
            {isEditingName ? (
              <input
                type="text"
                value={canvasName}
                onChange={(e) => setCanvasName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                className="bg-transparent border-b border-primary outline-none text-sm font-medium w-40"
                autoFocus
              />
            ) : (
              <span className="text-sm font-medium cursor-pointer hover:text-primary" onDoubleClick={() => setIsEditingName(true)}>
                {canvasName}
              </span>
            )}
            {hasUnsavedChanges && <span className="text-xs text-yellow-400 px-2 py-0.5 glass-button rounded-full">未保存</span>}
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => setShowTemplates(true)} className="px-3 py-1.5 glass-button rounded-lg text-xs flex items-center gap-1.5">
              <FileText size={14} /> 模板
            </button>
            <button onClick={executeWorkflow} className="px-3 py-1.5 bg-primary rounded-lg text-xs font-medium flex items-center gap-1.5">
              <Play size={14} /> 执行
            </button>
          </div>
        </header>

        {/* 画布区域 */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
          onMouseDown={handleCanvasMouseDown}
          onDoubleClick={handleCanvasDoubleClick}
          onWheel={handleWheel}
        >
          {/* 背景网格 */}
          <div
            className="canvas-bg absolute inset-0"
            style={{
              backgroundImage: showGrid ? 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)' : 'none',
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`
            }}
          />

          {/* 连接线 SVG */}
          <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
            <g style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {connections.map(conn => {
                const from = getNodePortPos(conn.fromNode, 'output')
                const to = getNodePortPos(conn.toNode, 'input')
                const midX = (from.x + to.x) / 2
                return (
                  <g key={conn.id}>
                    <path
                      d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
                      fill="none"
                      stroke="rgba(59, 130, 246, 0.6)"
                      strokeWidth={2}
                    />
                    <circle cx={to.x} cy={to.y} r={4} fill="#3b82f6" />
                  </g>
                )
              })}
              
              {/* 正在连接的线 */}
              {connectingFrom && (
                <path
                  d={`M ${getNodePortPos(connectingFrom, 'output').x} ${getNodePortPos(connectingFrom, 'output').y} L ${(connectingPos.x - pan.x) / zoom} ${(connectingPos.y - pan.y) / zoom}`}
                  fill="none"
                  stroke="rgba(59, 130, 246, 0.4)"
                  strokeWidth={2}
                  strokeDasharray="5,5"
                />
              )}
            </g>
          </svg>

          {/* 节点容器 */}
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            {nodes.filter(n => n.visible).sort((a, b) => a.zIndex - b.zIndex).map(node => (
              <NodeComponent
                key={node.id}
                node={node}
                isSelected={selectedNodes.has(node.id)}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onUpdate={(updates) => updateNode(node.id, updates)}
                onDelete={() => deleteNode(node.id)}
                onDuplicate={() => duplicateNode(node.id)}
                onGenerate={() => generateContent(node.id)}
                onStartConnect={() => setConnectingFrom(node.id)}
                onEndConnect={() => {
                  if (connectingFrom && connectingFrom !== node.id) {
                    createConnection(connectingFrom, node.id)
                  }
                  setConnectingFrom(null)
                }}
                zoom={zoom}
              />
            ))}
          </div>

          {/* 空画布提示 */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center pointer-events-auto">
                <div className="flex justify-center gap-4 mb-6">
                  {NODE_TYPES.slice(0, 3).map((item, i) => (
                    <button
                      key={item.type}
                      onClick={() => createNode(item.type)}
                      className="w-20 h-20 glass-card rounded-2xl flex flex-col items-center justify-center gap-2 hover:ring-2 hover:ring-primary transition-all"
                    >
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center`}>
                        <item.icon size={18} className="text-white" />
                      </div>
                      <span className="text-xs text-gray-400">{item.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-gray-500 text-sm">双击画布添加节点，或选择上方模板</p>
              </div>
            </div>
          )}
        </div>

        {/* 底部缩放控制 */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 glass-dark rounded-xl p-2 z-10">
          <button onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.25))} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-400 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(prev => Math.min(prev + 0.1, 3))} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ZoomIn size={16} />
          </button>
          <div className="w-px h-4 bg-white/10" />
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="p-1.5 hover:bg-white/10 rounded-lg" title="重置视图">
            <RotateCcw size={16} />
          </button>
        </div>

        {/* 右下角添加按钮 */}
        <button
          onClick={() => { setAddMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); setShowAddMenu(true) }}
          className="absolute bottom-4 right-4 w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg hover:opacity-90 z-10"
        >
          <Plus size={22} />
        </button>
      </main>

      {/* 添加节点菜单 */}
      {showAddMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
          <div
            className="fixed glass-dark rounded-2xl shadow-2xl p-3 z-50 w-56 animate-scaleIn"
            style={{ left: Math.min(addMenuPos.x, window.innerWidth - 240), top: Math.min(addMenuPos.y, window.innerHeight - 350) }}
          >
            <div className="text-xs text-gray-500 px-3 py-2">添加节点</div>
            {NODE_TYPES.map((item, i) => (
              <button
                key={item.type}
                onClick={() => {
                  const rect = canvasRef.current?.getBoundingClientRect()
                  if (rect) {
                    createNode(item.type, (addMenuPos.x - rect.left - pan.x) / zoom, (addMenuPos.y - rect.top - pan.y) / zoom)
                  } else {
                    createNode(item.type)
                  }
                }}
                className="w-full px-3 py-2 flex items-center gap-3 hover:bg-white/10 rounded-xl transition-all"
              >
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${item.gradient} flex items-center justify-center`}>
                  <item.icon size={14} className="text-white" />
                </div>
                <div className="text-left">
                  <div className="text-sm">{item.label}</div>
                  <div className="text-xs text-gray-500">{item.desc}</div>
                </div>
              </button>
            ))}
            <div className="border-t border-white/5 mt-2 pt-2">
              <button className="w-full px-3 py-2 flex items-center gap-3 hover:bg-white/10 rounded-xl">
                <div className="w-8 h-8 rounded-lg glass flex items-center justify-center">
                  <Upload size={14} />
                </div>
                <span className="text-sm">上传文件</span>
              </button>
            </div>
            <button onClick={() => setShowAddMenu(false)} className="absolute top-3 right-3 p-1.5 hover:bg-white/10 rounded-lg">
              <X size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// 节点组件
interface NodeComponentProps {
  node: CanvasNode
  isSelected: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onUpdate: (updates: Partial<CanvasNode>) => void
  onDelete: () => void
  onDuplicate: () => void
  onGenerate: () => void
  onStartConnect: () => void
  onEndConnect: () => void
  zoom: number
}

function NodeComponent({
  node, isSelected, onMouseDown, onUpdate, onDelete, onDuplicate, onGenerate, onStartConnect, onEndConnect, zoom
}: NodeComponentProps) {
  const [inputValue, setInputValue] = useState(node.content)
  const [showToolbar, setShowToolbar] = useState(false)
  const [showModelSelect, setShowModelSelect] = useState(false)
  const { settings } = useSettingsStore()

  useEffect(() => {
    setInputValue(node.content)
  }, [node.content])

  const handleGenerate = () => {
    onUpdate({ content: inputValue })
    setTimeout(onGenerate, 100)
  }

  const config = NODE_TYPES.find(t => t.type === node.type)!

  // 根据节点类型获取可用模型
  const getAvailableModels = () => {
    if (node.type === 'image') {
      return [
        { id: 'settings', name: `使用设置 (${settings.image.model || settings.image.provider})`, provider: settings.image.provider },
        { id: 'wanx', name: '通义万相', provider: 'dashscope' },
        { id: 'flux', name: 'Flux', provider: 'replicate' },
        { id: 'sdxl', name: 'SDXL', provider: 'replicate' },
      ]
    }
    if (node.type === 'text' || node.type === 'script') {
      return [
        { id: 'settings', name: `使用设置 (${settings.llm.model || settings.llm.provider})`, provider: settings.llm.provider },
        { id: 'doubao', name: '豆包', provider: 'doubao' },
        { id: 'qwen', name: '通义千问', provider: 'dashscope' },
        { id: 'gpt4', name: 'GPT-4', provider: 'openai' },
      ]
    }
    if (node.type === 'video') {
      return [
        { id: 'settings', name: `使用设置 (${settings.video.model || settings.video.provider})`, provider: settings.video.provider },
        { id: 'wan-video', name: '万象视频', provider: 'dashscope' },
      ]
    }
    return [{ id: 'default', name: '默认', provider: 'default' }]
  }

  const models = getAvailableModels()
  const currentModel = models.find(m => m.id === node.model) || models[0]

  return (
    <div
      className={`absolute glass-card rounded-2xl shadow-xl transition-shadow ${isSelected ? 'ring-2 ring-primary shadow-primary/20' : ''} ${node.locked ? 'opacity-70' : ''}`}
      style={{ left: node.x, top: node.y, width: node.width, zIndex: node.zIndex }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {/* 工具栏 */}
      {showToolbar && !node.locked && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 glass-dark rounded-lg px-2 py-1 animate-fadeIn">
          <button onClick={onDuplicate} className="p-1.5 hover:bg-white/10 rounded" title="复制"><Copy size={14} /></button>
          <button onClick={() => onUpdate({ locked: !node.locked })} className="p-1.5 hover:bg-white/10 rounded" title="锁定">
            {node.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button onClick={() => onUpdate({ visible: false })} className="p-1.5 hover:bg-white/10 rounded" title="隐藏"><EyeOff size={14} /></button>
          <div className="w-px h-4 bg-white/10" />
          <button onClick={onDelete} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded" title="删除"><Trash2 size={14} /></button>
        </div>
      )}

      {/* 标题栏 */}
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${config.gradient} flex items-center justify-center`}>
            <config.icon size={12} className="text-white" />
          </div>
          <span className="text-xs font-medium text-gray-300">{node.title}</span>
        </div>
        <div className="flex items-center gap-1">
          {node.status === 'generating' && <Loader2 size={14} className="animate-spin text-primary" />}
          {node.status === 'done' && <Check size={14} className="text-green-400" />}
          {node.status === 'error' && <AlertCircle size={14} className="text-red-400" />}
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-3">
        {/* 图片/视频预览 */}
        {(node.type === 'image' || node.type === 'video') && (
          <div className="aspect-video glass rounded-xl mb-3 overflow-hidden flex items-center justify-center">
            {node.status === 'generating' ? (
              <div className="text-center">
                <Loader2 size={24} className="animate-spin text-primary mx-auto mb-2" />
                <span className="text-xs text-gray-400">生成中...</span>
              </div>
            ) : node.imageUrl ? (
              <img src={node.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : node.videoUrl ? (
              <video src={node.videoUrl} className="w-full h-full object-cover" controls />
            ) : (
              <div className="text-center text-gray-500">
                <config.icon size={28} className="mx-auto mb-2 opacity-50" />
                <p className="text-xs">输入描述生成{node.type === 'image' ? '图片' : '视频'}</p>
              </div>
            )}
          </div>
        )}

        {/* 文本/剧本内容显示 */}
        {(node.type === 'text' || node.type === 'script') && node.status === 'done' && node.content && (
          <div className="text-sm text-gray-300 mb-3 max-h-32 overflow-auto whitespace-pre-wrap bg-white/5 rounded-lg p-2">
            {node.content}
          </div>
        )}

        {/* 错误提示 */}
        {node.error && (
          <div className="text-xs text-red-400 mb-2 flex items-center gap-1">
            <AlertCircle size={12} /> {node.error}
          </div>
        )}

        {/* 输入区 */}
        <div className="space-y-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`输入${config.label}描述...`}
            className="w-full bg-white/5 rounded-lg p-2.5 text-sm outline-none resize-none placeholder:text-gray-500 focus:ring-1 focus:ring-primary/50"
            rows={3}
            disabled={node.locked || node.status === 'generating'}
          />
          
          {/* 模型选择 */}
          <div className="relative">
            <button
              onClick={() => setShowModelSelect(!showModelSelect)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 bg-white/5 rounded-lg text-xs hover:bg-white/10 transition-all"
              disabled={node.locked || node.status === 'generating'}
            >
              <span className="text-gray-400">模型:</span>
              <span className="flex items-center gap-1">
                {currentModel.name}
                <ChevronDown size={12} className={`transition-transform ${showModelSelect ? 'rotate-180' : ''}`} />
              </span>
            </button>
            
            {showModelSelect && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowModelSelect(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 glass-dark rounded-lg py-1 z-20 animate-fadeIn">
                  {models.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { onUpdate({ model: m.id }); setShowModelSelect(false) }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 flex items-center justify-between ${node.model === m.id ? 'text-primary' : 'text-gray-300'}`}
                    >
                      {m.name}
                      {node.model === m.id && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setInputValue(prev => prev + '\n高清细节, 专业摄影, 电影级光影'); }}
              className="p-1.5 hover:bg-white/10 rounded-lg text-yellow-400"
              title="优化提示词"
            >
              <Sparkles size={14} />
            </button>
            
            <button
              onClick={handleGenerate}
              disabled={!inputValue.trim() || node.status === 'generating' || node.locked}
              className="px-3 py-1.5 bg-primary rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1.5"
            >
              {node.status === 'generating' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              生成
            </button>
          </div>
        </div>
      </div>

      {/* 连接点 */}
      <div
        className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 glass rounded-full border-2 border-white/30 cursor-crosshair hover:border-primary hover:scale-125 transition-all"
        onMouseUp={onEndConnect}
        title="输入"
      />
      <div
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 glass rounded-full border-2 border-white/30 cursor-crosshair hover:border-primary hover:scale-125 transition-all"
        onMouseDown={(e) => { e.stopPropagation(); onStartConnect() }}
        title="输出"
      />
    </div>
  )
}
