import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Sparkles, Layers, Film, Clock, ChevronDown, ChevronRight,
  Plus, RotateCcw, Image as ImageIcon,
  Play, Pause, SkipBack, SkipForward, Maximize2, Bot, ChevronLeft, Save,
  Wand2, Loader2, Trash2, Edit3, Check, Zap, CheckCircle, AlertCircle,
  FileText, Music, Mic, Volume2, Settings2, Eye, Download, Package
} from 'lucide-react'
import { 
  agentChat, agentPlanProject, agentGenerateElementPrompt,
  createAgentProject, getAgentProject, updateAgentProject, listAgentProjects,
  generateImage, generateVideo, checkVideoTaskStatus,
  generateProjectElements, generateProjectFrames,
  generateProjectVideos, executeProjectPipeline,
  exportProjectAssets, exportMergedVideo,
  type AgentProject, type AgentElement, type AgentSegment, type AgentShot
} from '../services/api'
import ChatInput from '../components/ChatInput'

type ModuleType = 'elements' | 'storyboard' | 'timeline'
type GenerationStage = 'idle' | 'planning' | 'elements' | 'frames' | 'videos' | 'audio' | 'complete'
type TaskCardType = 'brief' | 'storyboard' | 'visual' | 'genPath' | 'narration' | 'music' | 'timeline'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: unknown
  options?: ChatOption[]
  confirmButton?: { label: string; action: string }
  progress?: ProgressItem[]
}

interface ChatOption {
  id: string
  label: string
  value: string
  selected?: boolean
}

interface ProgressItem {
  label: string
  completed: boolean
}

interface VisualAsset {
  id: string
  name: string
  url: string
  duration?: string
  type: 'element' | 'start_frame' | 'video'
  status?: 'pending' | 'generating' | 'completed' | 'failed'
}

interface AudioAsset {
  id: string
  name: string
  url?: string
  type: 'narration' | 'dialogue' | 'music' | 'sfx'
  duration?: string
  status?: 'pending' | 'generating' | 'completed'
}

interface CreativeBrief {
  title?: string
  videoType?: string
  narrativeDriver?: string
  emotionalTone?: string
  visualStyle?: string
  duration?: string
  aspectRatio?: string
  language?: string
  [key: string]: string | undefined
}

export default function AgentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  
  const urlProjectId = location.pathname.match(/\/agent\/([^/]+)/)?.[1] || null
  
  const [activeModule, setActiveModule] = useState<ModuleType>('elements')
  const [projectName, setProjectName] = useState('未命名项目')
  const [projectId, setProjectId] = useState<string | null>(urlProjectId)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // Agent 项目历史
  const [agentProjects, setAgentProjects] = useState<AgentProject[]>([])
  const [showProjectList, setShowProjectList] = useState(!urlProjectId) // 没有项目ID时显示列表
  
  // 项目数据
  const [elements, setElements] = useState<Record<string, AgentElement>>({})
  const [segments, setSegments] = useState<AgentSegment[]>([])
  const [visualAssets, setVisualAssets] = useState<VisualAsset[]>([])
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([])
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>({})

  // 生成状态
  const [generationStage, setGenerationStage] = useState<GenerationStage>('idle')
  
  // 任务卡片展开状态
  const [expandedCards, setExpandedCards] = useState<Set<TaskCardType>>(new Set(['brief']))

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: `你好！我是 YuanYuan AI 视频制作助手 ✨

我可以帮你将创意转化为完整的视频作品。只需要告诉我你想制作什么，我会：

**第一步** 📋 分析需求，制定创意简报
**第二步** 🎬 设计分镜，规划镜头序列  
**第三步** 🎨 生成角色和场景素材
**第四步** 🎥 将静态画面转化为动态视频
**第五步** 🎵 添加旁白和背景音乐

请描述你想制作的视频，例如：
「制作格林童话《白蛇》的短片，时长1分钟，画风吉卜力2D」`,
      options: [
        { id: 'example1', label: '童话故事短片', value: '制作一个1分钟的童话短片，讲述白蛇的故事，画风吉卜力2D' },
        { id: 'example2', label: '产品宣传视频', value: '制作一个30秒的产品宣传视频，现代简约风格' },
        { id: 'example3', label: '教育动画', value: '制作一个2分钟的科普教育动画，解释光合作用' }
      ]
    }
  ])
  
  // 用于中断请求的 AbortController
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const [inputMessage, setInputMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingForConfirm, setWaitingForConfirm] = useState<string | null>(null)
  
  const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set())
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set())
  
  const [editingElement, setEditingElement] = useState<string | null>(null)
  const [generatingElement, setGeneratingElement] = useState<string | null>(null)
  const [retryingShot, setRetryingShot] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false)
      }
    }
    
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showExportMenu])

  // 加载 Agent 项目历史
  useEffect(() => {
    loadAgentProjects()
  }, [])

  const loadAgentProjects = async () => {
    try {
      const projects = await listAgentProjects(20)
      setAgentProjects(projects)
    } catch (error) {
      console.error('加载 Agent 项目列表失败:', error)
    }
  }

  // 记录来源项目 ID（如果是从普通项目进入的）
  const [parentProjectId, setParentProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (urlProjectId) {
      loadProject(urlProjectId)
      setShowProjectList(false)
    }
  }, [urlProjectId])

  const loadProject = async (id: string) => {
    try {
      setIsLoading(true)
      const project = await getAgentProject(id)
      setProjectId(project.id)
      setProjectName(project.name)
      setElements(project.elements || {})
      setSegments(project.segments || [])
      setCreativeBrief((project.creative_brief || {}) as CreativeBrief)
      
      // 转换 visual_assets
      const assets: VisualAsset[] = (project.visual_assets || []).map((a: { id: string; url: string; duration?: string; type?: string }) => ({
        id: a.id,
        name: a.id.replace(/^(asset_|frame_|video_)/, ''),
        url: a.url,
        duration: a.duration,
        type: (a.type as 'element' | 'start_frame' | 'video') || 'element',
        status: 'completed' as const
      }))
      setVisualAssets(assets)
      setHasUnsavedChanges(false)
    } catch (error: unknown) {
      console.error('加载项目失败:', error)
      
      // 检查是否是 404 错误（项目不存在）
      // 这通常意味着 URL 中的 ID 是普通项目 ID，不是 Agent 项目 ID
      const isNotFound = error instanceof Error && 
        (error.message.includes('404') || 
         (error as { response?: { status?: number } }).response?.status === 404)
      
      if (isNotFound && urlProjectId) {
        console.log('[Agent] 项目不存在，可能是从普通项目进入，开始新的 Agent 项目')
        // 记录来源项目 ID，以便后续关联
        setParentProjectId(urlProjectId)
        // 清除 projectId，让用户开始新项目
        setProjectId(null)
        // 更新 URL，移除无效的项目 ID
        navigate('/agent', { replace: true })
        // 显示提示
        addMessage('assistant', `👋 欢迎使用 YuanYuan Agent！

检测到你是从项目页面进入的，我已为你准备好新的 Agent 工作区。

请告诉我你想制作什么视频，我会帮你完成从创意到成片的全流程。`)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // 只有在有实际项目数据时才标记为未保存
    // 排除初始欢迎消息（messages.length > 1）
    if (Object.keys(elements).length > 0 || segments.length > 0) {
      setHasUnsavedChanges(true)
    }
  }, [elements, segments])

  // 添加消息的辅助函数
  const addMessage = useCallback((
    role: 'user' | 'assistant', 
    content: string, 
    data?: unknown,
    options?: ChatOption[],
    confirmButton?: { label: string; action: string },
    progress?: ProgressItem[]
  ) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role,
      content,
      data,
      options,
      confirmButton,
      progress
    }])
  }, [])

  // 保存项目
  const handleSaveProject = useCallback(async (showAlert = true) => {
    try {
      const projectData: Partial<AgentProject> = {
        name: projectName,
        creative_brief: creativeBrief,
        elements,
        segments,
        visual_assets: visualAssets.map(a => ({ id: a.id, url: a.url, duration: a.duration, type: a.type }))
      }
      
      console.log('[AgentPage] 保存项目:', { projectId, projectData })
      
      if (projectId) {
        const updated = await updateAgentProject(projectId, projectData)
        console.log('[AgentPage] 项目已更新:', updated)
        setHasUnsavedChanges(false)
        if (showAlert) {
          addMessage('assistant', '✅ 项目已保存')
        }
      } else {
        const newProject = await createAgentProject(projectName, creativeBrief)
        console.log('[AgentPage] 新项目已创建:', newProject)
        setProjectId(newProject.id)
        navigate(`/agent/${newProject.id}`, { replace: true })
        // 创建后立即更新完整数据
        if (Object.keys(elements).length > 0 || segments.length > 0) {
          await updateAgentProject(newProject.id, projectData)
          console.log('[AgentPage] 新项目数据已更新')
        }
        setHasUnsavedChanges(false)
        if (showAlert) {
          addMessage('assistant', '✅ 项目已保存')
        }
      }
    } catch (error) {
      console.error('[AgentPage] 保存失败:', error)
      if (showAlert) {
        addMessage('assistant', `❌ 保存失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
  }, [projectId, projectName, creativeBrief, elements, segments, visualAssets, navigate, addMessage])

  const getBackTarget = () => urlProjectId ? `/project/${urlProjectId}` : '/'

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
    } else {
      navigate(getBackTarget())
    }
  }

  const handleSaveAndExit = async () => {
    await handleSaveProject(false)
    navigate(getBackTarget())
  }

  const handleExitWithoutSave = () => {
    navigate(getBackTarget())
  }

  // 切换任务卡片展开状态
  const toggleCard = (card: TaskCardType) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  }

  // 处理选项点击 - 直接执行对应操作
  const handleOptionClick = async (option: ChatOption) => {
    // 检查是否是操作类型的选项
    if (option.value === 'view_storyboard') {
      await handleConfirmClick('view_storyboard')
    } else if (option.value === 'execute_pipeline') {
      await handleConfirmClick('execute_pipeline')
    } else if (option.value === 'generate_elements') {
      await handleConfirmClick('generate_elements')
    } else if (option.value === 'generate_frames') {
      await handleConfirmClick('generate_frames')
    } else if (option.value === 'generate_videos') {
      await handleConfirmClick('generate_videos')
    } else if (option.value === 'view_timeline') {
      setActiveModule('timeline')
      addMessage('assistant', '已切换到时间轴面板 📽️')
    } else if (option.value === 'generate_audio') {
      addMessage('assistant', '🎵 音频生成功能即将上线，敬请期待！')
    } else {
      // 普通文本选项，填充到输入框并自动发送
      setInputMessage(option.value)
      // 延迟一下让状态更新，然后自动发送
      setTimeout(() => {
        const input = document.querySelector('textarea') as HTMLTextAreaElement
        if (input) {
          input.form?.requestSubmit()
        }
      }, 100)
    }
  }

  // 处理确认按钮点击
  const handleConfirmClick = async (action: string) => {
    setWaitingForConfirm(null)
    
    if (action === 'generate_elements') {
      await handleGenerateAllElements()
    } else if (action === 'generate_frames') {
      await handleGenerateAllFrames()
    } else if (action === 'generate_videos') {
      await handleGenerateAllVideos()
    } else if (action === 'execute_pipeline') {
      await handleExecutePipeline()
    } else if (action === 'view_storyboard') {
      // 切换到分镜面板并展开所有相关卡片
      setActiveModule('storyboard')
      // 展开所有任务卡片
      setExpandedCards(new Set(['brief', 'storyboard', 'visual', 'genPath']))
      // 展开所有元素和段落
      setExpandedElements(new Set(Object.keys(elements)))
      setExpandedSegments(new Set(segments.map(s => s.id)))
      
      // 设置下一步等待确认
      setWaitingForConfirm('generate_elements')
      
      addMessage('assistant', `好的，让我们来看看分镜设计 📽️

我已经为你展开了所有面板：
- **左侧** 查看角色元素和分镜序列
- **右侧** 查看 Creative Brief、故事板概览、Visual Assets

每个镜头都包含：
- 📝 镜头描述和提示词
- 🎭 涉及的角色元素
- 🗣️ 对应的旁白文本
- ⏱️ 预计时长

确认分镜没问题后，我们可以开始生成素材。`, undefined, [
        { id: 'gen_elements', label: '🎨 生成角色图片', value: 'generate_elements' },
        { id: 'gen_all', label: '🚀 一键生成全部', value: 'execute_pipeline' }
      ], { label: '开始生成角色图片', action: 'generate_elements' })
    }
  }

  // 中断当前操作
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setSending(false)
    setGenerationStage('idle')
    addMessage('assistant', '⏹️ 已中断操作')
  }

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return
    
    const userMsg = inputMessage
    addMessage('user', userMsg)
    setInputMessage('')
    setSending(true)
    
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()

    try {
      // 检测是否是确认指令（当有等待确认的操作时）
      const confirmPatterns = ['1', '确认', '确定', '好的', '继续', '下一步', 'ok', 'yes', '是']
      if (waitingForConfirm && confirmPatterns.some(p => userMsg.trim().toLowerCase() === p.toLowerCase())) {
        await handleConfirmClick(waitingForConfirm)
        return
      }
      
      // 检测是否是选择操作的指令
      if (userMsg.trim() === '2' && segments.length > 0) {
        // 调整规划细节 - 暂时提示
        addMessage('assistant', '好的，请告诉我你想调整哪些细节？比如：\n- 修改某个镜头的时长\n- 调整视觉风格\n- 增加或删除某个角色')
        return
      }
      if (userMsg.trim() === '3' && segments.length > 0) {
        // 补充其他需求
        addMessage('assistant', '请补充你的需求，比如：\n- 特定角色的外观设定\n- 场景的具体要求\n- 音乐或旁白的风格')
        return
      }
      
      // 检测是否是创作请求
      if (userMsg.includes('制作') || userMsg.includes('创建') || userMsg.includes('生成') || userMsg.includes('做一个')) {
        setGenerationStage('planning')
        
        addMessage('assistant', `收到！让我来分析你的需求... 🤔

**正在执行：**
- 📋 创建项目概要
- 📝 编写剧本
- 🎬 设计分镜
- 💰 制定生成路径`, undefined, undefined, undefined, [
          { label: 'Agent分析中', completed: false }
        ])
        
        const planResult = await agentPlanProject(userMsg)
        
        if (planResult.success && planResult.plan) {
          const plan = planResult.plan
          
          setCreativeBrief({
            title: plan.creative_brief.title,
            videoType: plan.creative_brief.video_type,
            narrativeDriver: plan.creative_brief.narrative_driver,
            emotionalTone: plan.creative_brief.emotional_tone,
            visualStyle: plan.creative_brief.visual_style,
            duration: plan.creative_brief.duration,
            aspectRatio: plan.creative_brief.aspect_ratio,
            language: plan.creative_brief.language
          })
          setProjectName(plan.creative_brief.title || projectName)
          
          const newElements: Record<string, AgentElement> = {}
          for (const elem of plan.elements) {
            newElements[elem.id] = {
              id: elem.id,
              name: elem.name,
              type: elem.type,
              description: elem.description,
              created_at: new Date().toISOString()
            }
          }
          setElements(newElements)
          setExpandedElements(new Set(Object.keys(newElements)))
          
          const newSegments: AgentSegment[] = plan.segments.map(seg => ({
            id: seg.id,
            name: seg.name,
            description: seg.description,
            shots: seg.shots.map(shot => ({
              id: shot.id,
              name: shot.name,
              type: shot.type,
              description: shot.description,
              prompt: shot.prompt,
              narration: shot.narration,
              duration: parseFloat(shot.duration) || 5,
              status: 'pending',
              created_at: new Date().toISOString()
            })),
            created_at: new Date().toISOString()
          }))
          setSegments(newSegments)
          setExpandedSegments(new Set(newSegments.map(s => s.id)))
          // 展开所有任务卡片（右侧面板）
          setExpandedCards(new Set(['brief', 'storyboard', 'visual', 'genPath']))
          // 切换到分镜模块以显示左侧面板
          setActiveModule('storyboard')
          
          const totalShots = newSegments.reduce((acc, s) => acc + s.shots.length, 0)
          const totalDuration = newSegments.reduce((acc, s) => 
            acc + s.shots.reduce((a, shot) => a + (shot.duration || 5), 0), 0)
          
          setGenerationStage('idle')
          setWaitingForConfirm('view_storyboard')
          
          // 自动保存项目
          try {
            const newBrief = {
              title: plan.creative_brief.title,
              videoType: plan.creative_brief.video_type,
              narrativeDriver: plan.creative_brief.narrative_driver,
              emotionalTone: plan.creative_brief.emotional_tone,
              visualStyle: plan.creative_brief.visual_style,
              duration: plan.creative_brief.duration,
              aspectRatio: plan.creative_brief.aspect_ratio,
              language: plan.creative_brief.language
            }
            const newProject = await createAgentProject(plan.creative_brief.title || projectName, newBrief)
            setProjectId(newProject.id)
            // 更新项目数据
            await updateAgentProject(newProject.id, {
              elements: newElements,
              segments: newSegments
            })
            navigate(`/agent/${newProject.id}`, { replace: true })
            console.log('[Agent] 项目已自动保存:', newProject.id)
          } catch (saveError) {
            console.error('[Agent] 自动保存失败:', saveError)
          }
          
          addMessage('assistant', `✅ **Agent分析完成！**

我已经为「${plan.creative_brief.title}」制定了完整的制作方案：

---

**📋 Creative Brief**
- Video Type: ${plan.creative_brief.video_type}
- Narrative Driver: ${plan.creative_brief.narrative_driver}
- 视觉风格: ${plan.creative_brief.visual_style}
- Duration: ${plan.creative_brief.duration}
- Aspect Ratio: ${plan.creative_brief.aspect_ratio}

---

**🎬 故事板**
- ${newSegments.length} 个段落
- ${totalShots} 个镜头
- 预计时长 ${Math.round(totalDuration)} 秒

---

**👥 关键角色**
${plan.elements.map(e => `- ${e.name} (${e.type})`).join('\n')}

---

**💰 预估成本**
- 角色设计: ${plan.cost_estimate.elements}
- 镜头生成: ${plan.cost_estimate.shots}
- 音频制作: ${plan.cost_estimate.audio}
- **总计: ${plan.cost_estimate.total}**

---

接下来，你可以：`, plan, [
            { id: 'view_sb', label: '📽️ 先让我看看分镜', value: 'view_storyboard' },
            { id: 'gen_all', label: '🚀 一键生成全部', value: 'execute_pipeline' },
            { id: 'gen_char', label: '🎨 先生成角色图片', value: 'generate_elements' }
          ], { label: '先让我看看分镜', action: 'view_storyboard' }, [
            { label: 'Agent分析完成', completed: true },
            { label: '资产配置完成', completed: true }
          ])
        } else {
          setGenerationStage('idle')
          const result = await agentChat(userMsg, projectId || undefined, { elements, segments })
          addMessage('assistant', result.content, result.data)
        }
      } else {
        const result = await agentChat(userMsg, projectId || undefined, { elements, segments })
        addMessage('assistant', result.content, result.data)
      }
    } catch (error: unknown) {
      console.error('发送失败:', error)
      setGenerationStage('idle')
      // 忽略中断错误
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      addMessage('assistant', `❌ 出现错误：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setSending(false)
      abortControllerRef.current = null
    }
  }

  // ========== 批量生成功能 ==========
  
  // 生成所有元素图片
  const handleGenerateAllElements = async () => {
    if (!projectId) {
      await handleSaveProject(false)
    }
    
    const pid = projectId || (await createAgentProject(projectName, creativeBrief)).id
    if (!projectId) setProjectId(pid)
    
    setGenerationStage('elements')
    const elementCount = Object.keys(elements).length
    
    addMessage('assistant', `🎨 **开始生成角色图片**

**第一步** 为每个角色生成优化的提示词
**第二步** 调用图像生成模型 (Nano Banana Pro)
**第三步** 生成 2K 高清角色设计图

共 ${elementCount} 个角色，预计需要 ${elementCount * 15} 秒...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: false }
    ])
    
    try {
      const result = await generateProjectElements(pid, creativeBrief.visualStyle || '吉卜力动画风格')
      
      await loadProject(pid)
      
      const successMsg = result.failed === 0 
        ? `✅ **角色图片生成完成！**

成功生成 ${result.generated} 个角色设计图。

你可以在右侧「Visual Assets」卡片中查看所有生成的图片。`
        : `⚠️ **角色图片生成部分完成**

- 成功：${result.generated} 个
- 失败：${result.failed} 个

失败的角色可以在左侧面板单独重试。`
      
      addMessage('assistant', successMsg, undefined, undefined, 
        { label: '继续生成起始帧', action: 'generate_frames' },
        [
          { label: '生成角色图片', completed: true },
          { label: '生成起始帧', completed: false }
        ]
      )
      
      setGenerationStage('idle')
    } catch (error) {
      console.error('生成失败:', error)
      addMessage('assistant', `❌ 生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
    }
  }
  
  // 生成所有起始帧
  const handleGenerateAllFrames = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }
    
    setGenerationStage('frames')
    const totalShots = segments.reduce((acc, s) => acc + s.shots.length, 0)
    
    addMessage('assistant', `🖼️ **开始生成起始帧**

**第一步** 解析镜头提示词中的角色引用
**第二步** 构建完整的场景描述
**第三步** 生成每个镜头的第一帧静态画面

共 ${totalShots} 个镜头，预计需要 ${totalShots * 20} 秒...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: true },
      { label: '生成起始帧', completed: false }
    ])
    
    try {
      const result = await generateProjectFrames(projectId, creativeBrief.visualStyle || '吉卜力动画风格')
      
      await loadProject(projectId)
      
      addMessage('assistant', `✅ **起始帧生成完成！**

成功生成 ${result.generated} 个镜头的起始帧。
${result.failed > 0 ? `\n⚠️ ${result.failed} 个镜头生成失败` : ''}

接下来，我们将把这些静态画面转化为动态视频。`, undefined, undefined,
        { label: '开始生成视频', action: 'generate_videos' },
        [
          { label: '生成角色图片', completed: true },
          { label: '生成起始帧', completed: true },
          { label: '生成视频', completed: false }
        ]
      )
      
      setGenerationStage('idle')
    } catch (error) {
      console.error('生成失败:', error)
      addMessage('assistant', `❌ 生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
    }
  }
  
  // 生成所有视频
  const handleGenerateAllVideos = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }
    
    setGenerationStage('videos')
    
    addMessage('assistant', `🎬 **开始生成视频**

**第一步** 准备起始帧和动态提示词
**第二步** 调用视频生成模型 (Seedance 1.5 Pro)
**第三步** 生成 720p 动态视频片段

这是最耗时的步骤，请耐心等待...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: true },
      { label: '生成起始帧', completed: true },
      { label: '生成视频', completed: false }
    ])
    
    try {
      const result = await generateProjectVideos(projectId, '720p')
      
      await loadProject(projectId)
      
      addMessage('assistant', `🎉 **视频生成完成！**

成功生成 ${result.generated} 个视频片段。
${result.failed > 0 ? `\n⚠️ ${result.failed} 个视频生成失败` : ''}

所有视频素材已准备就绪！你可以：
- 在「时间轴」面板预览和编辑
- 调整片段顺序和时长
- 添加旁白和背景音乐
- 导出最终视频`, undefined, [
        { id: 'view_timeline', label: '📽️ 查看时间轴', value: 'view_timeline' },
        { id: 'gen_audio', label: '🎵 生成音频', value: 'generate_audio' }
      ], undefined, [
        { label: '生成角色图片', completed: true },
        { label: '生成起始帧', completed: true },
        { label: '生成视频', completed: true },
        { label: '生成素材完成', completed: true }
      ])
      
      setGenerationStage('complete')
    } catch (error) {
      console.error('生成失败:', error)
      addMessage('assistant', `❌ 生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
    }
  }
  
  // 一键生成全部
  const handleExecutePipeline = async () => {
    if (!projectId) {
      await handleSaveProject(false)
    }
    
    const pid = projectId || (await createAgentProject(projectName, creativeBrief)).id
    if (!projectId) setProjectId(pid)
    
    setGenerationStage('elements')
    
    addMessage('assistant', `🚀 **开始一键生成全部素材**

我将依次执行以下步骤：

**第一步** 🎨 生成角色设计图 (Nano Banana Pro 2K)
**第二步** 🖼️ 生成镜头起始帧 (Nano Banana Pro 2K)
**第三步** 🎬 生成动态视频 (Seedance 1.5 Pro 720p)

整个过程可能需要几分钟，请耐心等待...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: false },
      { label: '生成起始帧', completed: false },
      { label: '生成视频', completed: false }
    ])
    
    try {
      const result = await executeProjectPipeline(
        pid,
        creativeBrief.visualStyle || '吉卜力动画风格',
        '720p'
      )
      
      await loadProject(pid)
      
      const stagesInfo = []
      if (result.stages.elements) {
        stagesInfo.push(`🎨 角色图片：${result.stages.elements.generated}/${result.stages.elements.total}`)
      }
      if (result.stages.frames) {
        stagesInfo.push(`🖼️ 起始帧：${result.stages.frames.generated}/${result.stages.frames.total}`)
      }
      if (result.stages.videos) {
        stagesInfo.push(`🎬 视频：${result.stages.videos.generated}/${result.stages.videos.total}`)
      }
      
      addMessage('assistant', `${result.success ? '🎉' : '⚠️'} **生成流程${result.success ? '完成' : '部分完成'}！**

${stagesInfo.join('\n')}

---

**总计生成：${result.total_generated} 个素材**
${result.total_failed > 0 ? `**失败：${result.total_failed} 个**` : ''}

${result.success 
  ? '所有素材已准备就绪！你可以在时间轴面板预览和导出视频。' 
  : '部分素材生成失败，可以在对应面板重试。'}`, undefined, [
        { id: 'view_timeline', label: '📽️ 查看时间轴', value: 'view_timeline' },
        { id: 'gen_audio', label: '🎵 生成音频', value: 'generate_audio' }
      ], undefined, [
        { label: '生成角色图片', completed: true },
        { label: '生成起始帧', completed: true },
        { label: '生成视频', completed: true },
        { label: '生成素材完成', completed: result.success }
      ])
      
      setGenerationStage(result.success ? 'complete' : 'idle')
    } catch (error) {
      console.error('执行失败:', error)
      addMessage('assistant', `❌ 执行失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
    }
  }

  // 为单个元素生成图片
  const handleGenerateElementImage = async (elementId: string) => {
    const element = elements[elementId]
    if (!element) return
    
    setGeneratingElement(elementId)
    
    try {
      const promptResult = await agentGenerateElementPrompt(
        element.name,
        element.type,
        element.description,
        creativeBrief.visualStyle || '吉卜力动画风格'
      )
      
      if (promptResult.success && promptResult.prompt) {
        const imageResult = await generateImage(
          promptResult.prompt,
          promptResult.negative_prompt,
          { width: 1024, height: 1024 }
        )
        
        setElements(prev => ({
          ...prev,
          [elementId]: {
            ...prev[elementId],
            image_url: imageResult.imageUrl
          }
        }))
        
        setVisualAssets(prev => [...prev, {
          id: `asset_${Date.now()}`,
          name: element.name,
          url: imageResult.imageUrl,
          type: 'element',
          status: 'completed'
        }])
        
        setHasUnsavedChanges(true)
      }
    } catch (error) {
      console.error('生成图片失败:', error)
      addMessage('assistant', `❌ 生成 ${element.name} 图片失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setGeneratingElement(null)
    }
  }

  const toggleElement = (id: string) => {
    setExpandedElements(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSegment = (id: string) => {
    setExpandedSegments(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddElement = () => {
    const newId = `Element_NEW_${Date.now()}`
    const newElement: AgentElement = {
      id: newId,
      name: newId,
      type: 'character',
      description: '请输入角色描述...',
      created_at: new Date().toISOString()
    }
    setElements(prev => ({ ...prev, [newId]: newElement }))
    setExpandedElements(prev => new Set([...prev, newId]))
    setEditingElement(newId)
    setHasUnsavedChanges(true)
  }

  const handleDeleteElement = (elementId: string) => {
    setElements(prev => {
      const next = { ...prev }
      delete next[elementId]
      return next
    })
    setHasUnsavedChanges(true)
  }

  const handleUpdateElement = (elementId: string, updates: Partial<AgentElement>) => {
    setElements(prev => ({
      ...prev,
      [elementId]: { ...prev[elementId], ...updates }
    }))
    setHasUnsavedChanges(true)
  }

  const handleAddSegment = () => {
    const newId = `Segment_NEW_${Date.now()}`
    const newSegment: AgentSegment = {
      id: newId,
      name: '新段落',
      description: '请输入段落描述...',
      shots: [],
      created_at: new Date().toISOString()
    }
    setSegments(prev => [...prev, newSegment])
    setExpandedSegments(prev => new Set([...prev, newId]))
    setHasUnsavedChanges(true)
  }

  // 重新生成单个镜头的起始帧
  const handleRetryFrame = async (shotId: string) => {
    if (!projectId) return
    
    setRetryingShot(shotId)
    try {
      // 找到镜头
      let targetShot: AgentShot | null = null
      for (const seg of segments) {
        const shot = seg.shots.find(s => s.id === shotId)
        if (shot) {
          targetShot = shot
          break
        }
      }
      
      if (!targetShot) {
        addMessage('assistant', '❌ 找不到该镜头')
        return
      }
      
      // 构建提示词
      const prompt = targetShot.prompt || targetShot.description
      const resolvedPrompt = prompt.replace(/\[Element_(\w+)\]/g, (match, id) => {
        const fullId = `Element_${id}`
        const element = elements[fullId]
        return element ? element.description || element.name : match
      })
      
      const fullPrompt = `${resolvedPrompt}, ${creativeBrief.visualStyle || '吉卜力动画风格'}, cinematic lighting, high quality, detailed`
      
      // 生成图片
      const result = await generateImage(fullPrompt, 'blurry, low quality, distorted', { width: 1920, height: 1080 })
      
      // 更新镜头
      setSegments(prev => prev.map(seg => ({
        ...seg,
        shots: seg.shots.map(s => s.id === shotId ? { ...s, start_image_url: result.imageUrl, status: 'frame_ready' } : s)
      })))
      
      // 保存项目
      await handleSaveProject(false)
      addMessage('assistant', `✅ 镜头「${targetShot.name}」起始帧已重新生成`)
    } catch (error) {
      console.error('重新生成起始帧失败:', error)
      addMessage('assistant', `❌ 重新生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRetryingShot(null)
    }
  }

  // 重新生成单个镜头的视频
  const handleRetryVideo = async (shotId: string) => {
    if (!projectId) return
    
    setRetryingShot(shotId)
    try {
      // 找到镜头
      let targetShot: AgentShot | null = null
      for (const seg of segments) {
        const shot = seg.shots.find(s => s.id === shotId)
        if (shot) {
          targetShot = shot
          break
        }
      }
      
      if (!targetShot) {
        addMessage('assistant', '❌ 找不到该镜头')
        return
      }
      
      if (!targetShot.start_image_url) {
        addMessage('assistant', '⚠️ 请先生成起始帧')
        return
      }
      
      // 构建视频提示词
      const videoPrompt = targetShot.prompt || targetShot.description
      
      // 生成视频
      const result = await generateVideo(targetShot.start_image_url, videoPrompt, {
        duration: targetShot.duration || 5,
        resolution: '720p'
      })
      
      // 如果是异步任务，需要轮询
      if (result.status === 'processing' || result.status === 'pending' || result.status === 'submitted') {
        addMessage('assistant', `⏳ 视频生成中，任务ID: ${result.taskId}`)
        
        // 轮询等待完成
        let attempts = 0
        const maxAttempts = 60 // 最多等待5分钟
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000))
          const status = await checkVideoTaskStatus(result.taskId)
          
          if (status.status === 'completed' || status.status === 'succeeded') {
            // 更新镜头
            setSegments(prev => prev.map(seg => ({
              ...seg,
              shots: seg.shots.map(s => s.id === shotId ? { ...s, video_url: status.videoUrl || '', status: 'video_ready' } : s)
            })))
            await handleSaveProject(false)
            addMessage('assistant', `✅ 镜头「${targetShot.name}」视频已重新生成`)
            return
          } else if (status.status === 'failed') {
            throw new Error(status.error || '视频生成失败')
          }
          
          attempts++
        }
        
        throw new Error('视频生成超时')
      } else if (result.status === 'completed' || result.status === 'succeeded') {
        // 直接完成
        setSegments(prev => prev.map(seg => ({
          ...seg,
          shots: seg.shots.map(s => s.id === shotId ? { ...s, video_url: result.videoUrl || '', status: 'video_ready' } : s)
        })))
        await handleSaveProject(false)
        addMessage('assistant', `✅ 镜头「${targetShot.name}」视频已重新生成`)
      }
    } catch (error) {
      console.error('重新生成视频失败:', error)
      // 更新状态为失败
      setSegments(prev => prev.map(seg => ({
        ...seg,
        shots: seg.shots.map(s => s.id === shotId ? { ...s, status: 'video_failed' } : s)
      })))
      addMessage('assistant', `❌ 重新生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRetryingShot(null)
    }
  }

  // 导出项目素材（纯前端实现）
  const handleExportAssets = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }
    
    setExporting(true)
    setShowExportMenu(false)
    
    try {
      addMessage('assistant', '📦 正在打包项目素材...')
      
      // 动态导入 JSZip
      const JSZip = (await import('jszip')).default
      const { saveAs } = await import('file-saver')
      
      const zip = new JSZip()
      
      // 创建文件夹
      const elementsFolder = zip.folder('1_角色元素')
      const framesFolder = zip.folder('2_镜头起始帧')
      const videosFolder = zip.folder('3_视频片段')
      
      let elementCount = 0
      let frameCount = 0
      let videoCount = 0
      
      // 下载角色元素图片
      for (const [elemId, elem] of Object.entries(elements)) {
        if (elem.image_url) {
          try {
            const response = await fetch(elem.image_url)
            const blob = await response.blob()
            elementsFolder?.file(`${elem.name || elemId}.png`, blob)
            elementCount++
          } catch (error) {
            console.error(`下载角色失败: ${elem.name}`, error)
          }
        }
      }
      
      // 下载镜头起始帧和视频
      for (const seg of segments) {
        for (const shot of seg.shots) {
          const shotName = shot.name || shot.id
          
          // 起始帧
          if (shot.start_frame_url) {
            try {
              const response = await fetch(shot.start_frame_url)
              const blob = await response.blob()
              framesFolder?.file(`${shotName}_frame.png`, blob)
              frameCount++
            } catch (error) {
              console.error(`下载起始帧失败: ${shotName}`, error)
            }
          }
          
          // 视频
          if (shot.video_url) {
            try {
              const response = await fetch(shot.video_url)
              const blob = await response.blob()
              videosFolder?.file(`${shotName}.mp4`, blob)
              videoCount++
            } catch (error) {
              console.error(`下载视频失败: ${shotName}`, error)
            }
          }
        }
      }
      
      // 创建项目信息文件
      let infoText = `项目名称: ${projectName}\n`
      infoText += `项目ID: ${projectId}\n\n`
      infoText += `=== 素材统计 ===\n`
      infoText += `角色元素: ${elementCount} 个\n`
      infoText += `镜头起始帧: ${frameCount} 个\n`
      infoText += `视频片段: ${videoCount} 个\n\n`
      infoText += `=== 分镜列表 ===\n`
      
      segments.forEach((seg, i) => {
        infoText += `\n段落 ${i + 1}: ${seg.name || 'Unnamed'}\n`
        infoText += `描述: ${seg.description || 'N/A'}\n`
        seg.shots.forEach((shot, j) => {
          infoText += `  镜头 ${j + 1}: ${shot.name || 'Unnamed'}\n`
          infoText += `    时长: ${shot.duration || 5}秒\n`
          infoText += `    描述: ${shot.description || 'N/A'}\n`
        })
      })
      
      zip.file('项目信息.txt', infoText)
      
      // 生成 ZIP 文件
      const content = await zip.generateAsync({ type: 'blob' })
      saveAs(content, `${projectName}_${projectId}_assets.zip`)
      
      addMessage('assistant', `✅ 项目素材已导出！

📦 已打包：
- 角色元素: ${elementCount} 个
- 镜头起始帧: ${frameCount} 个
- 视频片段: ${videoCount} 个

文件已开始下载。`)
    } catch (error) {
      console.error('导出素材失败:', error)
      addMessage('assistant', `❌ 导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  // 导出拼接视频（提示用户使用时间轴功能）
  const handleExportVideo = async (resolution: string = '720p') => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }
    
    const completedVideos = segments.flatMap(s => s.shots).filter(shot => shot.video_url)
    if (completedVideos.length === 0) {
      addMessage('assistant', '⚠️ 没有可导出的视频片段，请先生成视频')
      return
    }
    
    setShowExportMenu(false)
    
    // 由于浏览器无法直接拼接视频，提示用户下载素材后使用视频编辑软件
    addMessage('assistant', `🎬 视频拼接说明

浏览器无法直接拼接视频文件。你可以：

**方案 1：下载素材后手动拼接**
1. 点击「导出全部素材」下载所有视频片段
2. 使用视频编辑软件（如 剪映、PR、DaVinci Resolve）拼接

**方案 2：使用时间轴预览**
- 切换到「时间轴」面板
- 按顺序播放所有视频片段
- 使用屏幕录制工具录制

**方案 3：使用 FFmpeg（需要技术背景）**
- 下载素材包
- 使用 FFmpeg 命令行工具拼接视频

是否现在下载全部素材？`, undefined, [
      { id: 'export_assets', label: '📦 下载全部素材', value: 'export_assets' }
    ])
  }

  const modules = [
    { id: 'elements' as ModuleType, icon: Sparkles, label: '关键元素' },
    { id: 'storyboard' as ModuleType, icon: Film, label: '分镜' },
    { id: 'timeline' as ModuleType, icon: Clock, label: '时间线' }
  ]

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  // 显示项目列表（当没有打开具体项目时）
  if (showProjectList && !projectId) {
    return (
      <div className="h-full overflow-auto p-8 animate-fadeIn">
        <div className="max-w-4xl mx-auto">
          {/* 头部 */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate('/')} 
                className="p-2 glass-button rounded-xl text-gray-400 hover:text-white"
              >
                <ChevronLeft size={20} />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gradient">YuanYuan Agent</h1>
                <p className="text-sm text-gray-500">AI 驱动的一站式视频创作</p>
              </div>
            </div>
            <button
              onClick={() => setShowProjectList(false)}
              className="px-4 py-2 gradient-primary rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <Plus size={16} />
              新建项目
            </button>
          </div>

          {/* 历史项目列表 */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock size={18} className="text-gray-400" />
              历史项目
              <span className="text-xs text-gray-500 glass px-2 py-0.5 rounded-full">{agentProjects.length}</span>
            </h2>
            
            {agentProjects.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <Sparkles className="w-16 h-16 mx-auto mb-4 text-gray-500" />
                <h3 className="text-lg font-medium mb-2">还没有 Agent 项目</h3>
                <p className="text-sm text-gray-500 mb-6">点击「新建项目」开始你的第一个 AI 视频创作</p>
                <button
                  onClick={() => setShowProjectList(false)}
                  className="px-6 py-2.5 gradient-primary rounded-xl text-sm font-medium"
                >
                  开始创作
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      navigate(`/agent/${project.id}`)
                    }}
                    className="glass-card p-5 text-left hover-lift group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center">
                          <Sparkles size={18} className="text-white" />
                        </div>
                        <div>
                          <h3 className="font-medium group-hover:text-primary transition-apple">{project.name}</h3>
                          <p className="text-xs text-gray-500">
                            {new Date(project.created_at).toLocaleDateString('zh-CN', { 
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                            })}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-apple" />
                    </div>
                    
                    {/* 项目统计 */}
                    <div className="flex gap-4 text-xs text-gray-500">
                      {Object.keys(project.elements || {}).length > 0 && (
                        <span className="flex items-center gap-1">
                          <Sparkles size={12} />
                          {Object.keys(project.elements).length} 角色
                        </span>
                      )}
                      {(project.segments || []).length > 0 && (
                        <span className="flex items-center gap-1">
                          <Film size={12} />
                          {project.segments.reduce((acc, s) => acc + (s.shots?.length || 0), 0)} 镜头
                        </span>
                      )}
                      {(project.visual_assets || []).length > 0 && (
                        <span className="flex items-center gap-1">
                          <ImageIcon size={12} />
                          {project.visual_assets.length} 素材
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full animate-fadeIn">
      {/* 退出确认对话框 */}
      {showExitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fadeIn">
          <div className="glass-card p-6 rounded-2xl w-96 animate-scaleIn">
            <h3 className="text-lg font-semibold mb-2">保存项目？</h3>
            <p className="text-sm text-gray-400 mb-6">你有未保存的更改，是否在离开前保存？</p>
            <div className="flex gap-3">
              <button onClick={handleExitWithoutSave} className="flex-1 py-2.5 glass-button rounded-xl text-sm">不保存</button>
              <button onClick={() => setShowExitDialog(false)} className="flex-1 py-2.5 glass-button rounded-xl text-sm">取消</button>
              <button onClick={handleSaveAndExit} className="flex-1 py-2.5 gradient-primary rounded-xl text-sm font-medium">保存</button>
            </div>
          </div>
        </div>
      )}
      
      {/* 左侧模块导航 */}
      <aside className="w-16 glass-dark flex flex-col items-center py-4 border-r border-white/5">
        <button onClick={handleBack} className="p-3 rounded-xl mb-3 text-gray-400 hover:text-white glass-button transition-apple" title="返回">
          <ChevronLeft size={20} />
        </button>
        <div className="w-8 h-px bg-white/10 mb-3" />
        
        {modules.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveModule(id)}
            className={`p-3 rounded-xl mb-2 transition-all relative group ${activeModule === id ? 'glass-button text-white glow-soft' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
            title={label}
          >
            <Icon size={20} />
            <span className="absolute left-full ml-3 px-3 py-1.5 glass rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-apple pointer-events-none z-10">{label}</span>
          </button>
        ))}
        
        <div className="flex-1" />
        
        <button onClick={() => handleSaveProject(true)} className={`p-3 rounded-xl mb-2 transition-apple ${hasUnsavedChanges ? 'text-primary glass-button' : 'text-gray-500 hover:text-white hover:bg-white/5'}`} title="保存项目">
          <Save size={20} />
        </button>
        
        <div className="relative" ref={exportMenuRef}>
          <button 
            onClick={() => {
              console.log('[Export] 点击导出按钮', { projectId, exporting, showExportMenu })
              setShowExportMenu(!showExportMenu)
            }} 
            disabled={exporting || !projectId}
            className={`p-3 rounded-xl transition-apple ${!projectId ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/5'} disabled:opacity-30`}
            title={!projectId ? '请先保存项目' : '导出'}
          >
            {exporting ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
          </button>
          
          {showExportMenu && projectId && (
            <div className="absolute left-full ml-3 bottom-0 w-48 glass-card rounded-xl p-2 shadow-xl z-50 animate-scaleIn">
              <button
                onClick={() => {
                  console.log('[Export] 点击导出素材')
                  handleExportAssets()
                }}
                className="w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <Package size={16} />
                导出全部素材
              </button>
              <button
                onClick={() => {
                  console.log('[Export] 查看视频导出说明')
                  handleExportVideo()
                }}
                className="w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <Film size={16} />
                视频拼接说明
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 中间主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 px-5 flex items-center justify-between border-b border-white/5 glass-dark">
          <div className="flex items-center">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-500 flex items-center justify-center mr-3 shadow-lg shadow-purple-500/30">
              <Layers size={16} className="text-white" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setHasUnsavedChanges(true) }}
              className="bg-transparent text-sm font-medium focus:outline-none border-b-2 border-transparent focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && <span className="text-xs text-yellow-400 glass-button px-2 py-1 rounded-full">未保存</span>}
            {generationStage !== 'idle' && generationStage !== 'complete' && (
              <span className="text-xs text-primary glass-button px-2 py-1 rounded-full flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                {generationStage === 'planning' ? '规划中' : 
                 generationStage === 'elements' ? '生成角色' :
                 generationStage === 'frames' ? '生成起始帧' :
                 generationStage === 'videos' ? '生成视频' :
                 generationStage === 'audio' ? '生成音频' : '处理中'}
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-5">
          {activeModule === 'elements' && (
            <ElementsPanel 
              elements={elements}
              expandedElements={expandedElements}
              toggleElement={toggleElement}
              editingElement={editingElement}
              setEditingElement={setEditingElement}
              generatingElement={generatingElement}
              onGenerateImage={handleGenerateElementImage}
              onAddElement={handleAddElement}
              onDeleteElement={handleDeleteElement}
              onUpdateElement={handleUpdateElement}
              onGenerateAll={handleGenerateAllElements}
              isGenerating={generationStage === 'elements'}
            />
          )}
          
          {activeModule === 'storyboard' && (
            <StoryboardPanel
              segments={segments}
              expandedSegments={expandedSegments}
              toggleSegment={toggleSegment}
              elements={elements}
              onAddSegment={handleAddSegment}
              onGenerateFrames={handleGenerateAllFrames}
              onGenerateVideos={handleGenerateAllVideos}
              isGeneratingFrames={generationStage === 'frames'}
              isGeneratingVideos={generationStage === 'videos'}
              onRetryFrame={handleRetryFrame}
              onRetryVideo={handleRetryVideo}
              retryingShot={retryingShot}
            />
          )}
          
          {activeModule === 'timeline' && (
            <TimelinePanel segments={segments} />
          )}
        </div>
      </main>

      {/* 右侧 AI 助手面板 - YuanYuan 风格 */}
      <aside className="w-[420px] glass-dark border-l border-white/5 flex flex-col">
        {/* 头部 */}
        <div className="h-14 px-5 flex items-center border-b border-white/5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 flex items-center justify-center mr-3 shadow-lg shadow-pink-500/30">
            <Bot size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-medium">YuanYuan AI</span>
          <span className="ml-2 text-xs text-gray-500">视频制作助手</span>
        </div>

        {/* 可折叠任务卡片区域 */}
        <div className="flex-1 overflow-auto">
          {/* 对话消息 */}
          <div className="p-4 space-y-4">
            {messages.map((msg) => (
              <ChatMessageItem 
                key={msg.id} 
                message={msg} 
                onOptionClick={handleOptionClick}
                onConfirmClick={handleConfirmClick}
              />
            ))}
            
            {sending && (
              <div className="glass-card p-4 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center">
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-pink-400">YuanYuan 正在思考...</p>
                      <p className="text-xs text-gray-500">
                        {generationStage === 'planning' ? '分析需求中' : 
                         generationStage === 'elements' ? '生成角色图片' :
                         generationStage === 'frames' ? '生成起始帧' :
                         generationStage === 'videos' ? '生成视频' : '处理中'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleStopGeneration}
                    className="px-3 py-1.5 glass-button rounded-lg text-xs text-red-400 hover:bg-red-500/20 flex items-center gap-1"
                  >
                    <span>⏹</span> 停止
                  </button>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 任务卡片 */}
          <div className="px-4 pb-4 space-y-2">
            {/* Creative Brief 卡片 */}
            {Object.keys(creativeBrief).length > 0 && (
              <TaskCard
                title="Creative Brief"
                icon={<FileText size={14} />}
                expanded={expandedCards.has('brief')}
                onToggle={() => toggleCard('brief')}
                badge={creativeBrief.title}
              >
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Video Type</span>
                    <span>{creativeBrief.videoType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Narrative Driver</span>
                    <span>{creativeBrief.narrativeDriver}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">视觉风格</span>
                    <span>{creativeBrief.visualStyle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span>{creativeBrief.duration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Aspect Ratio</span>
                    <span>{creativeBrief.aspectRatio}</span>
                  </div>
                </div>
              </TaskCard>
            )}

            {/* 故事板卡片 */}
            {segments.length > 0 && (
              <TaskCard
                title="故事板"
                icon={<Film size={14} />}
                expanded={expandedCards.has('storyboard')}
                onToggle={() => toggleCard('storyboard')}
                badge={`${segments.length} 段落`}
              >
                <div className="space-y-2">
                  {segments.map((seg) => (
                    <button 
                      key={seg.id} 
                      onClick={() => {
                        setActiveModule('storyboard')
                        setExpandedSegments(prev => new Set([...prev, seg.id]))
                      }}
                      className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{seg.name}</span>
                        <span className="text-[10px] text-gray-500">{seg.shots.length} 镜头</span>
                      </div>
                      <p className="text-[10px] text-gray-400 line-clamp-2">{seg.description}</p>
                    </button>
                  ))}
                </div>
              </TaskCard>
            )}

            {/* Visual Assets 卡片 */}
            {visualAssets.length > 0 && (
              <TaskCard
                title="Visual Assets"
                icon={<ImageIcon size={14} />}
                expanded={expandedCards.has('visual')}
                onToggle={() => toggleCard('visual')}
                badge={<span className="text-green-400">{visualAssets.length}</span>}
              >
                <div className="grid grid-cols-4 gap-2">
                  {visualAssets.slice(0, 12).map((asset) => (
                    <div 
                      key={asset.id} 
                      className="relative group cursor-pointer"
                      onClick={() => window.open(asset.url, '_blank')}
                    >
                      <img 
                        src={asset.url} 
                        alt={asset.name} 
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                      {asset.duration && (
                        <span className="absolute bottom-1 right-1 text-[8px] glass-dark px-1 rounded">
                          {asset.duration}
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-apple rounded-lg flex items-center justify-center">
                        <Eye size={12} />
                      </div>
                    </div>
                  ))}
                  {visualAssets.length > 12 && (
                    <button 
                      onClick={() => setActiveModule('elements')}
                      className="aspect-square glass rounded-lg flex items-center justify-center text-xs text-gray-500 hover:text-white transition-apple"
                    >
                      +{visualAssets.length - 12}
                    </button>
                  )}
                </div>
              </TaskCard>
            )}

            {/* Visual Gen Path 卡片 */}
            {Object.keys(creativeBrief).length > 0 && (
              <TaskCard
                title="Visual Gen Path"
                icon={<Settings2 size={14} />}
                expanded={expandedCards.has('genPath')}
                onToggle={() => toggleCard('genPath')}
              >
                <div className="space-y-3 text-xs">
                  <button 
                    onClick={handleGenerateAllElements}
                    disabled={generationStage !== 'idle' || Object.keys(elements).length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px]">1</span>
                      <span className="font-medium">角色设计图</span>
                      {generationStage === 'elements' && <Loader2 size={12} className="animate-spin text-blue-400 ml-auto" />}
                      {Object.values(elements).filter(e => e.image_url).length > 0 && generationStage !== 'elements' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Nano Banana Pro (2K) - 高清角色形象</p>
                  </button>
                  <button 
                    onClick={handleGenerateAllFrames}
                    disabled={generationStage !== 'idle' || segments.length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px]">2</span>
                      <span className="font-medium">镜头起始帧</span>
                      {generationStage === 'frames' && <Loader2 size={12} className="animate-spin text-purple-400 ml-auto" />}
                      {segments.flatMap(s => s.shots).filter(s => s.start_image_url).length > 0 && generationStage !== 'frames' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Nano Banana Pro (2K) - 静态场景画面</p>
                  </button>
                  <button 
                    onClick={handleGenerateAllVideos}
                    disabled={generationStage !== 'idle' || segments.flatMap(s => s.shots).filter(s => s.start_image_url).length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-[10px]">3</span>
                      <span className="font-medium">动态视频</span>
                      {generationStage === 'videos' && <Loader2 size={12} className="animate-spin text-pink-400 ml-auto" />}
                      {segments.flatMap(s => s.shots).filter(s => s.video_url).length > 0 && generationStage !== 'videos' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Seedance 1.5 Pro (720p) - 图生视频</p>
                  </button>
                </div>
              </TaskCard>
            )}

            {/* Narration Assets 卡片 */}
            {audioAssets.filter(a => a.type === 'narration' || a.type === 'dialogue').length > 0 && (
              <TaskCard
                title="Narration Assets"
                icon={<Mic size={14} />}
                expanded={expandedCards.has('narration')}
                onToggle={() => toggleCard('narration')}
                badge={audioAssets.filter(a => a.type === 'narration').length.toString()}
              >
                <div className="space-y-2">
                  {audioAssets.filter(a => a.type === 'narration' || a.type === 'dialogue').map((audio) => (
                    <AudioAssetItem key={audio.id} asset={audio} />
                  ))}
                </div>
              </TaskCard>
            )}

            {/* Music & Sound 卡片 */}
            {audioAssets.filter(a => a.type === 'music' || a.type === 'sfx').length > 0 && (
              <TaskCard
                title="Music & Sound"
                icon={<Music size={14} />}
                expanded={expandedCards.has('music')}
                onToggle={() => toggleCard('music')}
              >
                <div className="space-y-2">
                  {audioAssets.filter(a => a.type === 'music' || a.type === 'sfx').map((audio) => (
                    <AudioAssetItem key={audio.id} asset={audio} />
                  ))}
                </div>
              </TaskCard>
            )}

            {/* 时间轴卡片 */}
            {segments.length > 0 && visualAssets.filter(a => a.type === 'video').length > 0 && (
              <TaskCard
                title="时间轴"
                icon={<Clock size={14} />}
                expanded={expandedCards.has('timeline')}
                onToggle={() => toggleCard('timeline')}
              >
                <div className="space-y-2">
                  <div className="flex gap-1 overflow-x-auto pb-2">
                    {visualAssets.filter(a => a.type === 'video').slice(0, 8).map((asset) => (
                      <div key={asset.id} className="flex-shrink-0 w-16">
                        <img src={asset.url} alt="" className="w-full h-10 object-cover rounded" />
                        <p className="text-[8px] text-gray-500 truncate mt-0.5">{asset.name}</p>
                        {asset.duration && <p className="text-[8px] text-gray-400">{asset.duration}</p>}
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={() => setActiveModule('timeline')}
                    className="w-full py-2 glass-button rounded-lg text-xs flex items-center justify-center gap-1"
                  >
                    <Maximize2 size={12} />
                    打开完整时间轴
                  </button>
                </div>
              </TaskCard>
            )}
          </div>
        </div>

        {/* 输入区域 */}
        <div className="p-4 border-t border-white/5">
          <ChatInput
            value={inputMessage}
            onChange={setInputMessage}
            onSend={handleSendMessage}
            onStop={() => setSending(false)}
            isLoading={sending}
            placeholder="描述你想制作的视频..."
            showModelSelector={true}
          />
        </div>
      </aside>
    </div>
  )
}

// 聊天消息组件 - 美化输出格式
function ChatMessageItem({ 
  message, 
  onOptionClick, 
  onConfirmClick 
}: { 
  message: ChatMessage
  onOptionClick: (opt: ChatOption) => void
  onConfirmClick: (action: string) => void
}) {
  // 解析消息内容，检测是否包含 JSON
  const renderContent = (content: string) => {
    // 检查是否是纯 JSON 格式
    const jsonMatch = content.match(/^\s*\{[\s\S]*\}\s*$/)
    if (jsonMatch) {
      try {
        const data = JSON.parse(content)
        return <JsonDataCard data={data} />
      } catch {
        // 不是有效 JSON，正常渲染
      }
    }
    
    // 检查是否包含 JSON 代码块
    const parts = content.split(/(```json[\s\S]*?```)/g)
    if (parts.length > 1) {
      return (
        <div className="space-y-3">
          {parts.map((part, idx) => {
            if (part.startsWith('```json')) {
              const jsonStr = part.replace(/```json\s*/, '').replace(/\s*```$/, '')
              try {
                const data = JSON.parse(jsonStr)
                return <JsonDataCard key={idx} data={data} />
              } catch {
                return <pre key={idx} className="text-xs glass p-3 rounded-lg overflow-auto">{jsonStr}</pre>
              }
            }
            return part.trim() ? (
              <div key={idx} className="text-sm leading-relaxed whitespace-pre-wrap">{part}</div>
            ) : null
          })}
        </div>
      )
    }
    
    // 普通文本，支持 Markdown 风格
    return <FormattedText content={content} />
  }
  
  if (message.role === 'user') {
    return (
      <div className="ml-8">
        <div className="glass-card p-3 rounded-2xl text-sm">{message.content}</div>
      </div>
    )
  }
  
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center">
          <span className="text-[10px] font-bold">Y</span>
        </div>
        <span className="text-sm font-medium text-pink-400">YuanYuan</span>
      </div>
      
      <div className="text-gray-300">
        {renderContent(message.content)}
      </div>
      
      {/* 进度指示器 - 静态显示完成状态 */}
      {message.progress && message.progress.length > 0 && (
        <div className="mt-3 glass p-3 rounded-xl space-y-2">
          {message.progress.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              {item.completed ? (
                <CheckCircle size={14} className="text-green-400" />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-500" />
              )}
              <span className={item.completed ? 'text-green-400' : 'text-gray-500'}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {/* 选项按钮 */}
      {message.options && message.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onOptionClick(opt)}
              className="px-3 py-1.5 glass-button rounded-lg text-xs hover:bg-white/10 transition-apple"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      
      {/* 确认按钮 */}
      {message.confirmButton && (
        <button
          onClick={() => onConfirmClick(message.confirmButton!.action)}
          className="mt-3 px-4 py-2 gradient-primary rounded-xl text-sm font-medium flex items-center gap-2"
        >
          <Zap size={14} />
          {message.confirmButton.label}
        </button>
      )}
    </div>
  )
}

// 格式化文本组件 - 支持简单 Markdown
function FormattedText({ content }: { content: string }) {
  const lines = content.split('\n')
  
  return (
    <div className="text-sm leading-relaxed space-y-2">
      {lines.map((line, idx) => {
        // 标题
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={idx} className="font-semibold text-white">{line.slice(2, -2)}</p>
        }
        // 加粗文本
        if (line.includes('**')) {
          const parts = line.split(/(\*\*.*?\*\*)/g)
          return (
            <p key={idx}>
              {parts.map((part, i) => 
                part.startsWith('**') && part.endsWith('**') 
                  ? <strong key={i} className="text-white">{part.slice(2, -2)}</strong>
                  : part
              )}
            </p>
          )
        }
        // 分隔线
        if (line.trim() === '---') {
          return <hr key={idx} className="border-white/10 my-2" />
        }
        // 列表项
        if (line.trim().startsWith('- ')) {
          return <p key={idx} className="pl-4">• {line.trim().slice(2)}</p>
        }
        // 空行
        if (!line.trim()) {
          return <div key={idx} className="h-2" />
        }
        // 普通文本
        return <p key={idx}>{line}</p>
      })}
    </div>
  )
}

// JSON 数据卡片组件 - 美化 JSON 输出
function JsonDataCard({ data }: { data: Record<string, unknown> }) {
  // 检测数据类型并渲染对应的卡片
  if (data.creative_brief) {
    return <CreativeBriefCard data={data} />
  }
  if (data.project_name || data.style_guide) {
    return <ProjectPlanCard data={data} />
  }
  if (data.next_options) {
    return <NextOptionsCard data={data} />
  }
  
  // 检测是否是项目规划数据（包含 elements 和 segments）
  if (data.elements || data.segments) {
    return <PlanSummaryCard data={data} />
  }
  
  // 通用美化卡片 - 不显示原始 JSON
  return <GenericDataCard data={data} />
}

// 通用数据卡片 - 美化显示任意结构
function GenericDataCard({ data }: { data: Record<string, unknown> }) {
  const renderValue = (value: unknown, depth = 0): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="text-gray-500">-</span>
    }
    
    if (typeof value === 'string') {
      return <span>{value}</span>
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return <span className="text-blue-400">{String(value)}</span>
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-gray-500">空列表</span>
      
      // 简单数组（字符串/数字）
      if (value.every(v => typeof v === 'string' || typeof v === 'number')) {
        return <span>{value.join('、')}</span>
      }
      
      // 复杂数组
      return (
        <div className="space-y-2 mt-1">
          {value.slice(0, 5).map((item, idx) => (
            <div key={idx} className="glass p-2 rounded-lg text-xs">
              {typeof item === 'object' && item !== null ? (
                Object.entries(item as Record<string, unknown>).slice(0, 3).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-gray-500">{formatKey(k)}:</span>{' '}
                    <span>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                  </div>
                ))
              ) : (
                String(item)
              )}
            </div>
          ))}
          {value.length > 5 && (
            <p className="text-xs text-gray-500">...还有 {value.length - 5} 项</p>
          )}
        </div>
      )
    }
    
    if (typeof value === 'object' && depth < 2) {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) return <span className="text-gray-500">-</span>
      
      return (
        <div className="glass p-2 rounded-lg mt-1 space-y-1">
          {entries.slice(0, 5).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="text-gray-500">{formatKey(k)}:</span>{' '}
              {renderValue(v, depth + 1)}
            </div>
          ))}
          {entries.length > 5 && (
            <p className="text-xs text-gray-500">...还有 {entries.length - 5} 项</p>
          )}
        </div>
      )
    }
    
    // 深层对象，简化显示
    return <span className="text-gray-400">[对象]</span>
  }
  
  // 过滤掉一些不需要显示的字段
  const filteredEntries = Object.entries(data).filter(([key]) => 
    !['type', 'success', 'raw'].includes(key)
  )
  
  if (filteredEntries.length === 0) {
    return null
  }
  
  return (
    <div className="glass p-4 rounded-xl space-y-3">
      {filteredEntries.map(([key, value]) => (
        <div key={key}>
          <p className="text-xs text-gray-500 mb-1">{formatKey(key)}</p>
          <div className="text-sm">{renderValue(value)}</div>
        </div>
      ))}
    </div>
  )
}

// 项目规划摘要卡片
function PlanSummaryCard({ data }: { data: Record<string, unknown> }) {
  const elements = data.elements as Array<{ id: string; name: string; type: string }> | Record<string, { name: string; type: string }> | undefined
  const segments = data.segments as Array<{ id: string; name: string; shots?: Array<unknown> }> | undefined
  const costEstimate = data.cost_estimate as Record<string, string> | undefined
  
  // 处理 elements 可能是数组或对象的情况
  const elementList = Array.isArray(elements) 
    ? elements 
    : elements 
      ? Object.values(elements) 
      : []
  
  const totalShots = segments?.reduce((acc, s) => acc + (s.shots?.length || 0), 0) || 0
  
  return (
    <div className="glass p-4 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-purple-400" />
        <span className="font-semibold text-white">项目规划摘要</span>
      </div>
      
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-blue-400">{elementList.length}</p>
          <p className="text-xs text-gray-500">角色/元素</p>
        </div>
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-purple-400">{segments?.length || 0}</p>
          <p className="text-xs text-gray-500">段落</p>
        </div>
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-pink-400">{totalShots}</p>
          <p className="text-xs text-gray-500">镜头</p>
        </div>
      </div>
      
      {elementList.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">关键角色</p>
          <div className="flex flex-wrap gap-2">
            {elementList.slice(0, 6).map((e, idx) => (
              <span key={idx} className="px-2 py-1 glass rounded-lg text-xs">
                {e.name} <span className="text-gray-500">({e.type})</span>
              </span>
            ))}
            {elementList.length > 6 && (
              <span className="px-2 py-1 text-xs text-gray-500">+{elementList.length - 6}</span>
            )}
          </div>
        </div>
      )}
      
      {costEstimate && (
        <div className="glass p-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-2">预估成本</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(costEstimate).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-gray-400">{formatKey(k)}</span>
                <span className={k === 'total' ? 'text-yellow-400 font-medium' : ''}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Creative Brief 卡片
function CreativeBriefCard({ data }: { data: Record<string, unknown> }) {
  const brief = data.creative_brief as Record<string, string | Record<string, unknown>>
  
  return (
    <div className="glass p-4 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-blue-400" />
        <span className="font-semibold text-white">Creative Brief</span>
      </div>
      
      <div className="grid grid-cols-2 gap-3 text-xs">
        {brief.project_name && (
          <div className="col-span-2">
            <p className="text-gray-500">项目名称</p>
            <p className="text-white font-medium">{String(brief.project_name)}</p>
          </div>
        )}
        {brief.duration && (
          <div>
            <p className="text-gray-500">时长</p>
            <p>{String(brief.duration)}</p>
          </div>
        )}
        {brief.style_guide && typeof brief.style_guide === 'object' && (
          <div className="col-span-2">
            <p className="text-gray-500 mb-1">视觉风格</p>
            <div className="glass p-2 rounded-lg">
              {Object.entries(brief.style_guide as Record<string, string | string[]>).map(([k, v]) => (
                <p key={k} className="text-xs">
                  <span className="text-gray-500">{formatKey(k)}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {brief.core_storyline && (
        <div>
          <p className="text-xs text-gray-500 mb-1">核心剧情</p>
          <p className="text-sm">{String(brief.core_storyline)}</p>
        </div>
      )}
      
      {brief.target_audience && (
        <div className="flex gap-4 text-xs">
          <div>
            <p className="text-gray-500">目标受众</p>
            <p>{String(brief.target_audience)}</p>
          </div>
          {brief.tone && (
            <div>
              <p className="text-gray-500">情感基调</p>
              <p>{String(brief.tone)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 项目规划卡片
function ProjectPlanCard({ data }: { data: Record<string, unknown> }) {
  const projectName = data.project_name as string | undefined
  const styleGuide = data.style_guide as Record<string, string | string[]> | undefined
  const coreStoryline = data.core_storyline as string | undefined
  
  return (
    <div className="glass p-4 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-purple-400" />
        <span className="font-semibold text-white">项目规划</span>
      </div>
      
      {projectName && (
        <p className="text-lg font-medium text-white">{projectName}</p>
      )}
      
      {styleGuide && typeof styleGuide === 'object' && (
        <div className="glass p-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-2">视觉风格指南</p>
          {Object.entries(styleGuide).map(([k, v]) => (
            <div key={k} className="text-xs mb-1">
              <span className="text-gray-400">{formatKey(k)}:</span>{' '}
              <span>{Array.isArray(v) ? v.join(', ') : String(v)}</span>
            </div>
          ))}
        </div>
      )}
      
      {coreStoryline && (
        <div>
          <p className="text-xs text-gray-500 mb-1">剧情概要</p>
          <p className="text-sm">{coreStoryline}</p>
        </div>
      )}
    </div>
  )
}

// 下一步选项卡片
function NextOptionsCard({ data }: { data: Record<string, unknown> }) {
  const options = data.next_options as string[]
  
  return (
    <div className="glass p-4 rounded-xl">
      <p className="text-xs text-gray-500 mb-3">接下来你可以选择：</p>
      <div className="space-y-2">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">
              {idx + 1}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 格式化 key 名称
function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}


// 任务卡片组件
function TaskCard({ 
  title, 
  icon, 
  expanded, 
  onToggle, 
  badge, 
  children 
}: { 
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <button 
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-apple"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{icon}</span>
          <span className="text-sm font-medium">{title}</span>
          {badge && (
            <span className="text-xs text-gray-500 glass px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

// 音频资产项组件
function AudioAssetItem({ asset }: { asset: AudioAsset }) {
  const [isPlaying, setIsPlaying] = useState(false)
  
  return (
    <div className="glass p-2 rounded-lg flex items-center gap-2">
      <button 
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-8 h-8 rounded-lg glass-button flex items-center justify-center flex-shrink-0"
      >
        {isPlaying ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{asset.name}</p>
        <div className="flex items-center gap-2 mt-1">
          {/* 简化的波形显示 */}
          <div className="flex-1 h-4 flex items-center gap-px">
            {Array.from({ length: 20 }).map((_, i) => (
              <div 
                key={i} 
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
          {asset.duration && (
            <span className="text-[10px] text-gray-500 flex-shrink-0">{asset.duration}</span>
          )}
        </div>
      </div>
      <button className="p-1.5 glass-button rounded-lg">
        <Volume2 size={12} />
      </button>
    </div>
  )
}

// 关键元素面板
function ElementsPanel({ 
  elements, expandedElements, toggleElement, editingElement, setEditingElement,
  generatingElement, onGenerateImage, onAddElement, onDeleteElement, onUpdateElement,
  onGenerateAll, isGenerating
}: { 
  elements: Record<string, AgentElement>
  expandedElements: Set<string>
  toggleElement: (id: string) => void
  editingElement: string | null
  setEditingElement: (id: string | null) => void
  generatingElement: string | null
  onGenerateImage: (id: string) => void
  onAddElement: () => void
  onDeleteElement: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<AgentElement>) => void
  onGenerateAll: () => void
  isGenerating: boolean
}) {
  const elementList = Object.values(elements)
  const completedCount = elementList.filter(e => e.image_url).length
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gradient">关键元素</h2>
          <p className="text-xs text-gray-500 mt-1">{completedCount}/{elementList.length} 已生成图片</p>
        </div>
        {elementList.length > 0 && (
          <button
            onClick={onGenerateAll}
            disabled={isGenerating || completedCount === elementList.length}
            className="px-4 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {isGenerating ? '生成中...' : '批量生成'}
          </button>
        )}
      </div>
      
      {elementList.length === 0 ? (
        <div className="text-center py-12 glass-card rounded-2xl">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-500" />
          <p className="text-gray-400 mb-4">还没有创建任何元素</p>
          <p className="text-sm text-gray-500 mb-6">在右侧对话框描述你的项目，AI 会自动规划角色</p>
          <button onClick={onAddElement} className="px-4 py-2 glass-button rounded-xl text-sm">
            <Plus size={16} className="inline mr-2" />手动添加
          </button>
        </div>
      ) : (
        <>
          {elementList.map((element) => (
            <div key={element.id} className="glass-card overflow-hidden">
              <button onClick={() => toggleElement(element.id)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple">
                {expandedElements.has(element.id) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <span className="font-medium text-sm flex-1 text-left">{element.name}</span>
                {element.image_url ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <AlertCircle size={16} className="text-yellow-400" />
                )}
                <span className="text-xs text-gray-500 px-2 py-0.5 glass rounded-full">{element.type}</span>
              </button>
              
              {expandedElements.has(element.id) && (
                <div className="px-4 pb-4">
                  {editingElement === element.id ? (
                    <div className="space-y-3">
                      <input type="text" value={element.name} onChange={(e) => onUpdateElement(element.id, { name: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" placeholder="元素名称" />
                      <select value={element.type} onChange={(e) => onUpdateElement(element.id, { type: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none bg-transparent">
                        <option value="character">角色</option>
                        <option value="object">物品</option>
                        <option value="scene">场景</option>
                      </select>
                      <textarea value={element.description} onChange={(e) => onUpdateElement(element.id, { description: e.target.value })} className="w-full px-3 py-2 glass rounded-lg text-sm focus:outline-none resize-none" rows={3} placeholder="详细描述..." />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingElement(null)} className="flex-1 py-2 glass-button rounded-lg text-sm flex items-center justify-center gap-1"><Check size={14} />完成</button>
                        <button onClick={() => onDeleteElement(element.id)} className="py-2 px-3 glass-button rounded-lg text-sm text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-400 mb-3">{element.description}</p>
                      {element.image_url ? (
                        <div className="relative group">
                          <img src={element.image_url} alt={element.name} className="w-full max-w-md rounded-xl" />
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                            <button onClick={() => onGenerateImage(element.id)} disabled={generatingElement === element.id} className="p-2 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50">
                              {generatingElement === element.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => onGenerateImage(element.id)} disabled={generatingElement === element.id} className="w-full h-32 glass-card rounded-xl flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50">
                          {generatingElement === element.id ? (
                            <><Loader2 size={24} className="text-primary animate-spin mb-2" /><span className="text-sm text-gray-400">生成中...</span></>
                          ) : (
                            <><Wand2 size={24} className="text-gray-500 mb-2" /><span className="text-sm text-gray-400">点击生成图片</span></>
                          )}
                        </button>
                      )}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setEditingElement(element.id)} className="flex-1 py-2 glass-button rounded-lg text-sm flex items-center justify-center gap-1"><Edit3 size={14} />编辑</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <button onClick={onAddElement} className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white hover:border-white/40 transition-apple flex items-center justify-center gap-2">
            <Plus size={18} />添加元素
          </button>
        </>
      )}
    </div>
  )
}


// 分镜面板
function StoryboardPanel({
  segments, expandedSegments, toggleSegment, elements, onAddSegment,
  onGenerateFrames, onGenerateVideos, isGeneratingFrames, isGeneratingVideos,
  onRetryFrame, onRetryVideo, retryingShot
}: {
  segments: AgentSegment[]
  expandedSegments: Set<string>
  toggleSegment: (id: string) => void
  elements: Record<string, AgentElement>
  onAddSegment: () => void
  onGenerateFrames: () => void
  onGenerateVideos: () => void
  isGeneratingFrames: boolean
  isGeneratingVideos: boolean
  onRetryFrame: (shotId: string) => void
  onRetryVideo: (shotId: string) => void
  retryingShot: string | null
}) {
  const allShots = segments.flatMap(seg => seg.shots)
  const framesCompleted = allShots.filter(s => s.start_image_url).length
  const videosCompleted = allShots.filter(s => s.video_url).length
  const totalDuration = allShots.reduce((acc, s) => acc + (s.duration || 5), 0)
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gradient">分镜</h2>
          <p className="text-xs text-gray-500 mt-1">
            {segments.length} 段落 · {allShots.length} 镜头 · {Math.round(totalDuration)}秒
          </p>
        </div>
        {allShots.length > 0 && (
          <div className="flex gap-2">
            <button onClick={onGenerateFrames} disabled={isGeneratingFrames || isGeneratingVideos} className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50">
              {isGeneratingFrames ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              起始帧 ({framesCompleted}/{allShots.length})
            </button>
            <button onClick={onGenerateVideos} disabled={isGeneratingFrames || isGeneratingVideos || framesCompleted === 0} className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50">
              {isGeneratingVideos ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
              视频 ({videosCompleted}/{allShots.length})
            </button>
          </div>
        )}
      </div>
      
      {/* 进度条 */}
      {allShots.length > 0 && (
        <div className="glass-card p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">起始帧</span>
            <span className="text-gray-500">{framesCompleted}/{allShots.length}</span>
          </div>
          <div className="h-2 glass rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all" style={{ width: `${(framesCompleted / allShots.length) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">视频</span>
            <span className="text-gray-500">{videosCompleted}/{allShots.length}</span>
          </div>
          <div className="h-2 glass rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all" style={{ width: `${(videosCompleted / allShots.length) * 100}%` }} />
          </div>
        </div>
      )}
      
      {segments.length === 0 ? (
        <div className="text-center py-12 glass-card rounded-2xl">
          <Film className="w-12 h-12 mx-auto mb-4 text-gray-500" />
          <p className="text-gray-400 mb-4">还没有创建任何分镜</p>
          <p className="text-sm text-gray-500 mb-6">在右侧对话框描述你的项目，AI 会自动规划分镜</p>
          <button onClick={onAddSegment} className="px-4 py-2 glass-button rounded-xl text-sm">
            <Plus size={16} className="inline mr-2" />手动添加
          </button>
        </div>
      ) : (
        <>
          {segments.map((segment) => (
            <div key={segment.id} className="glass-card overflow-hidden">
              <button onClick={() => toggleSegment(segment.id)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple">
                {expandedSegments.has(segment.id) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <span className="font-medium text-sm flex-1 text-left">{segment.name}</span>
                <span className="text-xs text-gray-500">{segment.shots.length} 镜头</span>
              </button>
              
              {expandedSegments.has(segment.id) && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-gray-400">{segment.description}</p>
                  {segment.shots.map((shot) => (
                    <ShotCard 
                      key={shot.id} 
                      shot={shot} 
                      elements={elements}
                      onRetryFrame={onRetryFrame}
                      onRetryVideo={onRetryVideo}
                      isRetrying={retryingShot === shot.id}
                    />
                  ))}
                  <button className="w-full p-3 glass border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white text-sm flex items-center justify-center gap-2">
                    <Plus size={16} />添加镜头
                  </button>
                </div>
              )}
            </div>
          ))}
          <button onClick={onAddSegment} className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white transition-apple flex items-center justify-center gap-2">
            <Plus size={18} />添加段落
          </button>
        </>
      )}
    </div>
  )
}

// 镜头卡片
function ShotCard({ 
  shot, 
  elements,
  onRetryFrame,
  onRetryVideo,
  isRetrying
}: { 
  shot: AgentShot
  elements: Record<string, AgentElement>
  onRetryFrame: (shotId: string) => void
  onRetryVideo: (shotId: string) => void
  isRetrying: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  
  const resolvedPrompt = shot.prompt?.replace(/\[Element_(\w+)\]/g, (match, id) => {
    const fullId = `Element_${id}`
    const element = elements[fullId]
    return element ? `[${element.name}]` : match
  }) || shot.description
  
  const shotTypeLabels: Record<string, string> = {
    standard: '标准叙事', quick: '快速切换', closeup: '特写', wide: '远景', montage: '蒙太奇'
  }
  
  const getStatusIcon = () => {
    if (shot.video_url) return <CheckCircle size={14} className="text-green-400" />
    if (shot.start_image_url) return <ImageIcon size={14} className="text-blue-400" />
    return <AlertCircle size={14} className="text-yellow-400" />
  }
  
  return (
    <div className="glass p-4 rounded-xl">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <span className="text-sm font-medium flex-1">{shot.name}</span>
        {getStatusIcon()}
        <span className="text-xs text-gray-500 px-2 py-0.5 glass rounded-full">{shotTypeLabels[shot.type] || shot.type}</span>
        <span className="text-xs text-gray-500">{shot.duration}s</span>
      </div>
      
      {expanded && (
        <div className="mt-3 pl-6 space-y-3">
          <p className="text-xs text-gray-500">{shot.description}</p>
          
          <div className="glass-dark p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">提示词</p>
            <p className="text-sm text-gray-300">{resolvedPrompt}</p>
          </div>
          
          {shot.narration && (
            <div className="glass-dark p-3 rounded-lg">
              <p className="text-xs text-gray-400 mb-1">旁白</p>
              <p className="text-sm text-gray-300 italic">"{shot.narration}"</p>
            </div>
          )}
          
          <div className="flex gap-2">
            {shot.start_image_url ? (
              <div className="relative group flex-1">
                <img src={shot.start_image_url} alt={shot.name} className="w-full rounded-lg" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-apple rounded-lg flex items-center justify-center">
                  <button 
                    onClick={() => onRetryFrame(shot.id)}
                    disabled={isRetrying}
                    className="p-2 glass rounded-lg hover:bg-white/20 disabled:opacity-50"
                  >
                    {isRetrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => onRetryFrame(shot.id)}
                disabled={isRetrying}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">生成中...</span></>
                ) : (
                  <><ImageIcon size={20} className="text-gray-500 mb-1" /><span className="text-xs text-gray-500">点击生成起始帧</span></>
                )}
              </button>
            )}
            
            {shot.video_url ? (
              <div className="relative group flex-1">
                <video 
                  src={shot.video_url} 
                  className="w-full rounded-lg" 
                  controls
                  muted
                  playsInline
                />
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-apple">
                  <button 
                    onClick={() => onRetryVideo(shot.id)}
                    disabled={isRetrying}
                    className="p-1.5 glass-dark rounded-lg hover:bg-white/20 disabled:opacity-50"
                    title="重新生成视频"
                  >
                    {isRetrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  </button>
                </div>
              </div>
            ) : shot.status === 'video_failed' ? (
              <button 
                onClick={() => onRetryVideo(shot.id)}
                disabled={isRetrying || !shot.start_image_url}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-red-500/50 hover:border-red-400 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">重新生成中...</span></>
                ) : (
                  <><AlertCircle size={20} className="text-red-400 mb-1" /><span className="text-xs text-red-400">生成失败，点击重试</span></>
                )}
              </button>
            ) : shot.start_image_url ? (
              <button 
                onClick={() => onRetryVideo(shot.id)}
                disabled={isRetrying}
                className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-primary/50 transition-apple disabled:opacity-50"
              >
                {isRetrying ? (
                  <><Loader2 size={20} className="text-primary animate-spin mb-1" /><span className="text-xs text-gray-400">生成中...</span></>
                ) : (
                  <><Film size={20} className="text-gray-500 mb-1" /><span className="text-xs text-gray-500">点击生成视频</span></>
                )}
              </button>
            ) : (
              <div className="flex-1 h-24 glass-dark rounded-lg flex flex-col items-center justify-center border border-dashed border-white/20">
                <Film size={20} className="text-gray-500 mb-1" />
                <span className="text-xs text-gray-500">需先生成起始帧</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// 时间线面板
function TimelinePanel({ segments }: { segments: AgentSegment[] }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  
  const allShots = segments.flatMap(seg => seg.shots)
  const completedVideos = allShots.filter(s => s.video_url)
  const totalDuration = allShots.reduce((acc, shot) => acc + (shot.duration || 5), 0)

  // 当前视频播放完毕，切换到下一个
  const handleVideoEnded = () => {
    if (currentVideoIndex < completedVideos.length - 1) {
      setCurrentVideoIndex(prev => prev + 1)
    } else {
      // 全部播放完毕
      setIsPlaying(false)
      setCurrentVideoIndex(0)
    }
  }

  // 播放/暂停控制
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  // 上一个视频
  const handlePrevious = () => {
    if (currentVideoIndex > 0) {
      setCurrentVideoIndex(prev => prev - 1)
      setIsPlaying(false)
    }
  }

  // 下一个视频
  const handleNext = () => {
    if (currentVideoIndex < completedVideos.length - 1) {
      setCurrentVideoIndex(prev => prev + 1)
      setIsPlaying(false)
    }
  }

  // 更新当前时间
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      // 计算总时间（之前视频的时长 + 当前视频的播放时间）
      const previousDuration = completedVideos
        .slice(0, currentVideoIndex)
        .reduce((acc, shot) => acc + (shot.duration || 5), 0)
      setCurrentTime(previousDuration + videoRef.current.currentTime)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 视频预览区 */}
      <div className="flex-1 flex items-center justify-center glass-card rounded-2xl mb-4">
        {completedVideos.length === 0 ? (
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 glass rounded-2xl flex items-center justify-center">
              <Film size={36} className="text-gray-500" />
            </div>
            <h3 className="text-lg font-medium mb-2 text-gradient">等待视频生成</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              {allShots.length > 0 
                ? `共 ${allShots.length} 个镜头待生成，请在分镜面板点击「生成视频」`
                : '请先在右侧对话框描述你的项目'}
            </p>
          </div>
        ) : (
          <div className="w-full max-w-3xl">
            <div className="aspect-video glass rounded-2xl flex items-center justify-center mb-4 overflow-hidden relative">
              <video 
                ref={videoRef}
                src={completedVideos[currentVideoIndex]?.video_url} 
                className="w-full h-full object-contain"
                onEnded={handleVideoEnded}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {/* 视频序号指示器 */}
              <div className="absolute top-4 right-4 glass px-3 py-1.5 rounded-lg text-xs font-medium">
                {currentVideoIndex + 1} / {completedVideos.length}
              </div>
              {/* 当前镜头名称 */}
              <div className="absolute bottom-4 left-4 glass px-3 py-1.5 rounded-lg text-xs">
                {completedVideos[currentVideoIndex]?.name}
              </div>
            </div>
            <p className="text-sm text-gray-400 text-center">
              {completedVideos.length}/{allShots.length} 个视频已生成 · 总时长 {Math.round(totalDuration)} 秒
            </p>
          </div>
        )}
      </div>

      {/* 播放控制 */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-center gap-4 mb-4">
          <span className="text-sm text-gray-400 w-16 font-mono">{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrevious}
              disabled={currentVideoIndex === 0}
              className="p-2.5 glass-button rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipBack size={18} />
            </button>
            <button 
              onClick={handlePlayPause} 
              disabled={completedVideos.length === 0}
              className="p-4 gradient-primary rounded-2xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button 
              onClick={handleNext}
              disabled={currentVideoIndex >= completedVideos.length - 1}
              className="p-2.5 glass-button rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipForward size={18} />
            </button>
          </div>
          <span className="text-sm text-gray-400 w-16 text-right font-mono">{formatTime(totalDuration)}</span>
          <button className="p-2.5 glass-button rounded-xl ml-4"><Maximize2 size={18} /></button>
        </div>

        {/* 时间轴 */}
        <div className="relative">
          <div className="flex justify-between text-xs text-gray-500 mb-3 px-1">
            {Array.from({ length: Math.min(6, Math.ceil(totalDuration / 10) + 1) }, (_, i) => (
              <span key={i} className="font-mono">{formatTime(i * 10)}</span>
            ))}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">视频</span>
              <div className="flex-1 h-12 glass rounded-xl relative overflow-hidden flex">
                {allShots.map((shot, index) => {
                  const width = totalDuration > 0 ? (shot.duration / totalDuration) * 100 : 0
                  const hasVideo = !!shot.video_url
                  const isCurrentVideo = completedVideos[currentVideoIndex]?.id === shot.id
                  return (
                    <div
                      key={shot.id}
                      className={`h-full flex items-center justify-center text-xs truncate px-1 border-r border-white/10 last:border-r-0 cursor-pointer transition-all ${
                        hasVideo ? '' : 'opacity-30'
                      } ${isCurrentVideo ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                      style={{ 
                        width: `${width}%`,
                        background: hasVideo 
                          ? `linear-gradient(135deg, hsl(${(index * 40) % 360}, 50%, ${isCurrentVideo ? 40 : 30}%), hsl(${(index * 40 + 30) % 360}, 50%, ${isCurrentVideo ? 30 : 20}%))`
                          : 'rgba(255,255,255,0.05)'
                      }}
                      title={shot.name}
                      onClick={() => {
                        if (hasVideo) {
                          const videoIndex = completedVideos.findIndex(v => v.id === shot.id)
                          if (videoIndex >= 0) {
                            setCurrentVideoIndex(videoIndex)
                            setIsPlaying(false)
                          }
                        }
                      }}
                    >
                      {width > 8 && shot.name.split('_').pop()}
                    </div>
                  )
                })}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">旁白</span>
              <div className="flex-1 h-8 glass rounded-xl relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-lg m-1" />
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">音乐</span>
              <div className="flex-1 h-8 glass rounded-xl relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg m-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}
