import axios from 'axios'
import type { ModelConfig } from '../store/settingsStore'

const API_BASE = 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 180000
})

export interface GenerateParams {
  referenceImage: string | null
  storyText: string
  style: string
  count: number
}

export interface StoryboardResult {
  id: string
  index: number
  prompt: string
  fullPrompt: string
  imageUrl: string
}

export interface FullSettings {
  llm: ModelConfig
  image: ModelConfig
  storyboard: ModelConfig
  video: ModelConfig
  tts?: {
    provider: string
    volc: {
      appid: string
      accessToken: string
      endpoint: string
      cluster: string
      model: string
      encoding: string
      rate: number
      speedRatio: number
      narratorVoiceType: string
      dialogueMaleVoiceType: string
      dialogueFemaleVoiceType: string
      dialogueVoiceType: string
    }
    fish: {
      apiKey: string
      baseUrl: string
      model: string
      encoding: string
      rate: number
      speedRatio: number
      narratorVoiceType: string
      dialogueMaleVoiceType: string
      dialogueFemaleVoiceType: string
      dialogueVoiceType: string
    }
    bailian: {
      apiKey: string
      baseUrl: string
      workspace: string
      model: string
      encoding: string
      rate: number
      speedRatio: number
      narratorVoiceType: string
      dialogueMaleVoiceType: string
      dialogueFemaleVoiceType: string
      dialogueVoiceType: string
    }
    custom: {
      encoding: string
      rate: number
      speedRatio: number
      narratorVoiceType: string
      dialogueMaleVoiceType: string
      dialogueFemaleVoiceType: string
      dialogueVoiceType: string
    }
  }
  local: {
    enabled: boolean
    comfyuiUrl: string
    sdWebuiUrl: string
    vramStrategy: string
  }
}

export type TestConnectionCategory = 'llm' | 'image' | 'storyboard' | 'video'

export interface TestConnectionResult {
  success: boolean
  level: 'none' | 'network' | 'auth' | 'call' | 'error'
  message: string
  details?: Record<string, unknown>
}

// 更新设置
export async function updateSettings(settings: FullSettings): Promise<void> {
  await api.post('/api/settings', settings)
}

// 获取已保存的设置
export async function getSavedSettings(): Promise<FullSettings | null> {
  try {
    const response = await api.get('/api/settings')
    if (response.data.status === 'not_configured') {
      return null
    }
    return response.data
  } catch {
    return null
  }
}

// 测试配置连通性（不会保存配置）
export async function testConnection(
  category: TestConnectionCategory,
  config: ModelConfig,
  local?: FullSettings['local']
): Promise<TestConnectionResult> {
  const response = await api.post('/api/test-connection', { category, config, local })
  return response.data as TestConnectionResult
}

export async function testTTSConnection(tts: NonNullable<FullSettings['tts']>, voiceType?: string, text?: string): Promise<{
  success: boolean
  message: string
  duration_ms?: number
}> {
  const response = await api.post('/api/tts/test', { tts, voiceType, text })
  return response.data
}

export type FishModel = {
  id: string
  title?: string
  description?: string
  visibility?: string
  type?: string
  tags?: string[]
  created_at?: string
  task_count?: number
  [key: string]: unknown
}

export type FishModelListResponse = {
  items: FishModel[]
  page_number?: number
  page_size?: number
  total?: number
  [key: string]: unknown
}

export async function fishListModels(params?: {
  page_size?: number
  page_number?: number
  title?: string
  tag?: string
  self_only?: boolean
  sort_by?: string
  model_type?: string
}): Promise<FishModelListResponse> {
  const response = await api.get('/api/fish/models', { params })
  return response.data as FishModelListResponse
}

export async function fishGetModel(modelId: string): Promise<FishModel> {
  const response = await api.get(`/api/fish/models/${encodeURIComponent(modelId)}`)
  return response.data as FishModel
}

export async function fishDeleteModel(modelId: string): Promise<void> {
  await api.delete(`/api/fish/models/${encodeURIComponent(modelId)}`)
}

export async function fishCreateModel(formData: FormData): Promise<FishModel> {
  const response = await api.post('/api/fish/models', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data as FishModel
}

// 生成分镜
export async function generateStoryboards(
  params: GenerateParams
): Promise<StoryboardResult[]> {
  const response = await api.post('/api/generate', params)
  return response.data.storyboards
}

// 拆解剧本（LLM）
export async function parseStory(
  storyText: string,
  count: number,
  style: string
): Promise<string[]> {
  const response = await api.post('/api/parse-story', { storyText, count, style })
  return response.data.prompts
}

// 单张重新生成
export async function regenerateImage(
  prompt: string,
  referenceImage: string | null,
  style: string
): Promise<string> {
  const response = await api.post('/api/regenerate', {
    prompt,
    referenceImage,
    style
  })
  return response.data.imageUrl
}

// 上传参考图
export async function uploadReference(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/upload-reference', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data.dataUrl
}

// 通用文件上传
export interface UploadResult {
  success: boolean
  file: {
    id: string
    name: string
    size: number
    type: string
    category: string
    url: string
    absoluteUrl?: string
    previewUrl?: string
    content?: string
  }
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000 // 5分钟超时，用于大文件
  })
  return response.data
}

// 批量上传文件
export async function uploadFiles(files: File[]): Promise<UploadResult[]> {
  const results: UploadResult[] = []
  for (const file of files) {
    try {
      const result = await uploadFile(file)
      results.push(result)
    } catch (error) {
      console.error(`上传文件失败: ${file.name}`, error)
    }
  }
  return results
}

// 单独生成图像
export async function generateImage(
  prompt: string,
  negativePrompt?: string,
  options?: {
    width?: number
    height?: number
    steps?: number
    seed?: number
    style?: string
  }
): Promise<{ imageUrl: string; seed: number; width: number; height: number; steps: number }> {
  const response = await api.post('/api/generate-image', {
    prompt,
    negativePrompt,
    width: options?.width || 1024,
    height: options?.height || 576,
    steps: options?.steps || 25,
    seed: options?.seed,
    style: options?.style
  })
  return response.data
}

// 健康检查
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await api.get('/health')
    return response.data.status === 'ok'
  } catch {
    return false
  }
}

// AI 对话 - 支持取消
let chatAbortController: AbortController | null = null

export async function chatWithAI(
  message: string,
  context?: string
): Promise<string> {
  // 取消之前的请求
  if (chatAbortController) {
    chatAbortController.abort()
  }
  chatAbortController = new AbortController()
  
  const response = await api.post('/api/chat', { message, context }, {
    signal: chatAbortController.signal
  })
  return response.data.reply
}

export function stopChatGeneration() {
  if (chatAbortController) {
    chatAbortController.abort()
    chatAbortController = null
  }
}

// 生成视频（从图片）
export async function generateVideo(
  imageUrl: string,
  prompt: string,
  options?: {
    duration?: number
    motionStrength?: number
    seed?: number
    resolution?: string
    ratio?: string
    cameraFixed?: boolean
    watermark?: boolean
    generateAudio?: boolean
  }
): Promise<{
  taskId: string
  status: string
  videoUrl: string | null
  duration: number
  seed: number
  error?: string
}> {
  const response = await api.post('/api/generate-video', {
    imageUrl,
    prompt,
    duration: options?.duration || 5,
    motionStrength: options?.motionStrength || 0.5,
    seed: options?.seed,
    resolution: options?.resolution || '720p',
    ratio: options?.ratio || '16:9',
    cameraFixed: options?.cameraFixed || false,
    watermark: options?.watermark || false,
    generateAudio: options?.generateAudio !== false
  })
  return response.data
}

// 检查视频任务状态
export async function checkVideoTaskStatus(taskId: string): Promise<{
  taskId: string
  status: string
  videoUrl: string | null
  progress?: number
  error?: string
}> {
  const response = await api.post('/api/video-task-status', { taskId })
  return response.data
}

// 获取视频历史
export interface GeneratedVideo {
  id: string
  task_id: string
  source_image: string
  prompt: string
  video_url: string | null
  status: string
  provider: string
  model: string
  duration: number
  seed: number
  created_at: string
  updated_at: string
}

export async function getVideoHistory(limit = 50): Promise<GeneratedVideo[]> {
  const response = await api.get('/api/videos/history', { params: { limit } })
  return response.data.videos
}

// 删除单个视频历史
export async function deleteVideoHistory(videoId: string): Promise<void> {
  await api.delete(`/api/videos/history/${videoId}`)
}

// 批量删除视频历史
export async function deleteVideosHistoryBatch(ids: string[]): Promise<{ deleted: number }> {
  const response = await api.post('/api/videos/history/delete-batch', { ids })
  return response.data
}

// ========== 项目管理 ==========

export interface Project {
  id: string
  name: string
  description?: string
  reference_image?: string
  story_text?: string
  style?: string
  status?: string
  storyboards?: StoryboardData[]
  created_at: string
  updated_at: string
}

export interface StoryboardData {
  id: string
  project_id: string
  index_num: number
  prompt: string
  full_prompt?: string
  image_url?: string
  status: string
  created_at: string
  updated_at: string
}

export async function createProject(
  name: string,
  description: string = ''
): Promise<Project> {
  const response = await api.post('/api/projects', { name, description })
  return response.data
}

export async function listProjects(
  limit = 50,
  offset = 0
): Promise<Project[]> {
  const response = await api.get('/api/projects', { params: { limit, offset } })
  return response.data.projects
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await api.get(`/api/projects/${projectId}`)
  return response.data
}

export async function updateProject(
  projectId: string,
  updates: Partial<Project>
): Promise<Project> {
  const response = await api.put(`/api/projects/${projectId}`, updates)
  return response.data
}

export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/api/projects/${projectId}`)
}

// ========== 分镜管理 ==========

export async function addStoryboard(
  projectId: string,
  prompt: string,
  fullPrompt = '',
  imageUrl = ''
): Promise<StoryboardData> {
  const response = await api.post(`/api/projects/${projectId}/storyboards`, {
    prompt,
    full_prompt: fullPrompt,
    image_url: imageUrl
  })
  return response.data
}

export async function updateStoryboard(
  projectId: string,
  storyboardId: string,
  updates: Partial<StoryboardData>
): Promise<StoryboardData> {
  const response = await api.put(
    `/api/projects/${projectId}/storyboards/${storyboardId}`,
    updates
  )
  return response.data
}

export async function deleteStoryboard(
  projectId: string,
  storyboardId: string
): Promise<void> {
  await api.delete(`/api/projects/${projectId}/storyboards/${storyboardId}`)
}

// ========== 剧本管理 ==========

export interface Script {
  id: string
  project_id?: string
  title: string
  content: string
  version?: number
  created_at: string
  updated_at: string
}

export async function saveScript(
  title: string,
  content: string,
  projectId?: string
): Promise<Script> {
  const response = await api.post('/api/scripts', {
    title,
    content,
    project_id: projectId
  })
  return response.data
}

export async function listScripts(
  projectId?: string,
  limit = 50
): Promise<Script[]> {
  const response = await api.get('/api/scripts', {
    params: { project_id: projectId, limit }
  })
  return response.data.scripts
}

export async function getScript(scriptId: string): Promise<Script> {
  const response = await api.get(`/api/scripts/${scriptId}`)
  return response.data
}

export async function updateScript(
  scriptId: string,
  title?: string,
  content?: string
): Promise<Script> {
  const response = await api.put(`/api/scripts/${scriptId}`, { title, content })
  return response.data
}

export async function deleteScript(scriptId: string): Promise<void> {
  await api.delete(`/api/scripts/${scriptId}`)
}

// ========== 图像历史 ==========

export interface GeneratedImage {
  id: string
  prompt: string
  negative_prompt?: string
  image_url: string
  provider?: string
  model?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  style?: string
  created_at: string
}

export async function getImageHistory(limit = 100): Promise<GeneratedImage[]> {
  const response = await api.get('/api/images/history', { params: { limit } })
  return response.data.images
}

// 删除单个图像历史
export async function deleteImageHistory(imageId: string): Promise<void> {
  await api.delete(`/api/images/history/${imageId}`)
}

// 批量删除图像历史
export async function deleteImagesHistoryBatch(ids: string[]): Promise<{ deleted: number }> {
  const response = await api.post('/api/images/history/delete-batch', { ids })
  return response.data
}

// ========== 对话历史 ==========

export interface ChatMessage {
  id: string
  session_id: string
  module: string
  role: string
  content: string
  created_at: string
}

export async function saveChatMessage(
  sessionId: string,
  module: string,
  role: string,
  content: string
): Promise<ChatMessage> {
  const response = await api.post('/api/chat/history', {
    session_id: sessionId,
    module,
    role,
    content
  })
  return response.data
}

export async function getChatHistory(
  sessionId: string,
  module?: string,
  limit = 50
): Promise<ChatMessage[]> {
  const response = await api.get(`/api/chat/history/${sessionId}`, {
    params: { module, limit }
  })
  return response.data.history
}

export async function clearChatHistory(
  sessionId: string,
  module?: string
): Promise<void> {
  await api.delete(`/api/chat/history/${sessionId}`, { params: { module } })
}


// ========== 历史记录 ==========

export async function getProjectHistory(
  projectId: string
): Promise<{ history: Array<{ action: string; timestamp: string; data?: unknown }> }> {
  const response = await api.get(`/api/projects/${projectId}/history`)
  return response.data
}

export async function getScriptHistory(
  scriptId: string
): Promise<{ history: Array<{ action: string; timestamp: string; changes?: unknown }> }> {
  const response = await api.get(`/api/scripts/${scriptId}/history`)
  return response.data
}

export async function listChatSessions(
  limit = 50
): Promise<Array<{ session_id: string; message_count: number; created_at: string; updated_at: string }>> {
  const response = await api.get('/api/chat/sessions', { params: { limit } })
  return response.data.sessions
}

// ========== 数据导出/导入 ==========

export async function exportAllData(
  includeImages = true
): Promise<{ path: string; filename: string }> {
  const response = await api.post('/api/export/all', null, {
    params: { include_images: includeImages }
  })
  return response.data
}

export async function exportProject(
  projectId: string
): Promise<{ path: string; filename: string }> {
  const response = await api.post(`/api/export/project/${projectId}`)
  return response.data
}

export async function listExports(): Promise<
  Array<{ filename: string; path: string; size: number; created_at: string }>
> {
  const response = await api.get('/api/exports')
  return response.data.exports
}

export function getExportDownloadUrl(filename: string): string {
  return `${API_BASE}/api/export/download/${filename}`
}

export async function importData(
  file: File,
  merge = true
): Promise<{ success: boolean; stats?: { projects: number; scripts: number; chat: number; skipped: number }; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/import', formData, {
    params: { merge },
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data
}

export async function importProject(
  file: File
): Promise<Project> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/import/project', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data
}

// ========== 统计 ==========

export async function getStats(): Promise<{
  projects: number
  scripts: number
  chat_sessions: number
  generated_images: number
  data_dir: string
}> {
  const response = await api.get('/api/stats')
  return response.data
}

export async function getImageStats(): Promise<{
  total: number
  by_provider: Record<string, number>
}> {
  const response = await api.get('/api/images/stats')
  return response.data
}

// ========== Agent API ==========

export interface AgentChatResponse {
  type: 'text' | 'structured' | 'action' | 'error'
  content: string
  data?: unknown
  action?: string
  options?: Array<{ id: string; label: string; value: string }>
  confirmButton?: { label: string; action: string; payload?: unknown }
  progress?: Array<{ label: string; completed: boolean }>
}

export interface AgentProjectPlan {
  creative_brief: {
    title: string
    video_type: string
    narrative_driver: string
    emotional_tone: string
    visual_style: string
    duration: string
    aspect_ratio: string
    language: string
    narratorVoiceProfile?: string
    narrator_voice_profile?: string
    ttsSpeedRatio?: string
    targetDurationSeconds?: string
  }
  elements: Array<{
    id: string
    name: string
    type: string
    description: string
    voice_profile?: string
  }>
  segments: Array<{
    id: string
    name: string
    description: string
    shots: Array<{
      id: string
      name: string
      type: string
      duration: string
      description: string
      prompt: string
      video_prompt?: string
      narration: string
      dialogue_script?: string
    }>
  }>
  cost_estimate: {
    elements: string
    shots: string
    audio: string
    total: string
  }
}

// 元素图片历史记录
export interface ElementImageHistory {
  id: string
  url: string
  source_url?: string
  created_at: string
  is_favorite: boolean  // 是否被收藏（用户选定）
}

export interface AgentElement {
  id: string
  name: string
  type: string
  description: string
  voice_profile?: string
  cached_image_url?: string
  image_url?: string  // 当前使用的图片（收藏的或最新的）
  image_history?: ElementImageHistory[]  // 图片生成历史
  reference_images?: string[]  // 用户上传的多张参考图（角色/场景/道具一致性）
  created_at: string
}

export interface AgentSegment {
  id: string
  name: string
  description: string
  shots: AgentShot[]
  created_at: string
}

// 镜头图片历史记录
export interface ShotImageHistory {
  id: string
  url: string
  source_url?: string
  created_at: string
  is_favorite: boolean
}

export interface AgentShot {
  id: string
  name: string
  type: string
  description: string
  prompt: string
  video_prompt?: string
  dialogue_script?: string
  narration: string
  duration: number
  start_image_url?: string
  cached_start_image_url?: string
  start_image_history?: ShotImageHistory[]  // 起始帧历史
  video_url?: string
  reference_images?: string[]  // 用户上传的多张参考图（优先用于场景/道具对齐）
  voice_audio_url?: string
  voice_audio_duration_ms?: number
  narration_audio_url?: string
  narration_audio_duration_ms?: number
  dialogue_audio_url?: string
  dialogue_audio_duration_ms?: number
  status: string
  created_at: string
}

// Agent 聊天消息类型
export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: unknown
  options?: Array<{ id: string; label: string; value: string }>
  confirmButton?: { label: string; action: string; payload?: unknown }
  progress?: Array<{ label: string; completed: boolean }>
  created_at?: string
}

export interface AgentProject {
  id: string
  name: string
  creative_brief: Record<string, unknown>
  elements: Record<string, AgentElement>
  segments: AgentSegment[]
  visual_assets: Array<{ id: string; url: string; duration?: string }>
  audio_assets: Array<{ id: string; url: string; type: string }>
  audio_timeline?: AudioTimeline
  timeline: Array<{ id: string; type: string; start: number; duration: number }>
  messages: AgentChatMessage[]
  created_at: string
  updated_at: string
}

export interface AudioTimelineShot {
  shot_id: string
  shot_name: string
  timecode_start: number
  timecode_end: number
  duration: number
  voice_audio_url?: string
  voice_duration_ms?: number
  narration_audio_url?: string
  narration_duration_ms?: number
  dialogue_audio_url?: string
  dialogue_duration_ms?: number
}

export interface AudioTimelineSegment {
  segment_id: string
  segment_name: string
  shots: AudioTimelineShot[]
}

export interface AudioTimeline {
  version: string
  confirmed: boolean
  updated_at?: string
  master_audio_url?: string
  total_duration: number
  segments: AudioTimelineSegment[]
}

export interface ShotType {
  name: string
  duration: string
  description: string
}

// Agent 对话
export async function agentChat(
  message: string,
  projectId?: string,
  context?: Record<string, unknown>
): Promise<AgentChatResponse> {
  const response = await api.post('/api/agent/chat', {
    message,
    projectId,
    context
  })
  return response.data
}

// Agent 项目规划
export async function agentPlanProject(
  userRequest: string,
  style: string = '吉卜力2D'
): Promise<{ success: boolean; plan?: AgentProjectPlan; error?: string }> {
  const response = await api.post('/api/agent/plan', {
    userRequest,
    style
  }, {
    timeout: 300000 // 5分钟超时，规划可能需要较长时间
  })
  return response.data
}

// 生成元素提示词
export async function agentGenerateElementPrompt(
  elementName: string,
  elementType: string,
  baseDescription: string,
  visualStyle: string = '吉卜力动画风格'
): Promise<{ success: boolean; prompt?: string; negative_prompt?: string; recommended_resolution?: string; error?: string }> {
  const response = await api.post('/api/agent/element-prompt', {
    elementName,
    elementType,
    baseDescription,
    visualStyle
  })
  return response.data
}

// 生成镜头提示词
export async function agentGenerateShotPrompt(
  shotName: string,
  shotType: string,
  shotDescription: string,
  elements: string[],
  visualStyle: string,
  narration: string
): Promise<{ success: boolean; image_prompt?: string; video_prompt?: string; camera_movement?: string; duration_seconds?: number; error?: string }> {
  const response = await api.post('/api/agent/shot-prompt', {
    shotName,
    shotType,
    shotDescription,
    elements,
    visualStyle,
    narration
  })
  return response.data
}

// 获取镜头类型
export async function getShotTypes(): Promise<Record<string, ShotType>> {
  const response = await api.get('/api/agent/shot-types')
  return response.data.shotTypes
}

// Agent 项目管理
export async function createAgentProject(
  name: string,
  creativeBrief?: Record<string, unknown>
): Promise<AgentProject> {
  const response = await api.post('/api/agent/projects', {
    name,
    creativeBrief
  })
  return response.data
}

export async function listAgentProjects(limit: number = 50): Promise<AgentProject[]> {
  const response = await api.get('/api/agent/projects', { params: { limit } })
  return response.data.projects
}

export async function getAgentProject(projectId: string): Promise<AgentProject> {
  const response = await api.get(`/api/agent/projects/${projectId}`)
  return response.data
}

export async function updateAgentProject(
  projectId: string,
  updates: Partial<AgentProject>
): Promise<AgentProject> {
  const response = await api.put(`/api/agent/projects/${projectId}`, updates)
  return response.data
}

export async function applyAgentOperator(
  projectId: string,
  request: { kind: 'actions' | 'patch'; payload: unknown; executeRegenerate?: boolean }
): Promise<{ success: boolean; project?: AgentProject; applied?: unknown; regen_results?: unknown; ui_hints?: unknown; error?: string }> {
  const response = await api.post(`/api/agent/projects/${projectId}/operator/apply`, {
    kind: request.kind,
    payload: request.payload,
    executeRegenerate: request.executeRegenerate ?? true
  })
  return response.data
}

export async function deleteAgentProject(projectId: string): Promise<void> {
  await api.delete(`/api/agent/projects/${projectId}`)
}

// Agent 工作流增强
export async function scriptDoctorAgentProject(
  projectId: string,
  options?: { mode?: 'light' | 'expand'; apply?: boolean }
): Promise<{ success: boolean; project: AgentProject; patch?: unknown; updates?: unknown }> {
  const response = await api.post(
    `/api/agent/projects/${projectId}/script-doctor`,
    { mode: options?.mode || 'expand', apply: options?.apply ?? true },
    { timeout: 300000 }
  )
  return response.data
}

export async function completeAssetsAgentProject(
  projectId: string,
  options?: { apply?: boolean }
): Promise<{ success: boolean; project: AgentProject; added_elements?: AgentElement[]; raw?: unknown; updates?: unknown }> {
  const response = await api.post(
    `/api/agent/projects/${projectId}/complete-assets`,
    { apply: options?.apply ?? true },
    { timeout: 300000 }
  )
  return response.data
}

export async function audioCheckAgentProject(
  projectId: string,
  options?: { includeNarration?: boolean; includeDialogue?: boolean; speed?: number; apply?: boolean }
): Promise<{ success: boolean; issues: Array<Record<string, unknown>>; suggestions: Record<string, number>; project: AgentProject }> {
  const response = await api.post(
    `/api/agent/projects/${projectId}/audio-check`,
    {
      includeNarration: options?.includeNarration ?? true,
      includeDialogue: options?.includeDialogue ?? true,
      speed: options?.speed ?? 1.0,
      apply: options?.apply ?? false
    },
    { timeout: 120000 }
  )
  return response.data
}

export async function exportProjectAssets(
  projectId: string,
  options?: {
    signal?: AbortSignal
    onProgress?: (progress: { loaded: number; total?: number; percent?: number }) => void
  }
): Promise<Blob> {
  const response = await api.post(
    `/api/agent/projects/${projectId}/export/assets`,
    {},
    {
      responseType: 'blob',
      signal: options?.signal,
      onDownloadProgress: (event) => {
        const loaded = event.loaded
        const total = typeof event.total === 'number' ? event.total : undefined
        const percent = total ? Math.round((loaded / total) * 100) : undefined
        options?.onProgress?.({ loaded, total, percent })
      }
    }
  )
  return response.data
}

export async function exportMergedVideo(projectId: string, resolution: string = '720p'): Promise<Blob> {
  const response = await api.post(`/api/agent/projects/${projectId}/export/video?resolution=${resolution}`, {}, {
    responseType: 'blob'
  })
  return response.data
}

// Agent 元素管理
export async function addAgentElement(
  projectId: string,
  element: {
    elementId: string
    name: string
    elementType: string
    description: string
    imageUrl?: string
  }
): Promise<AgentElement> {
  const response = await api.post(`/api/agent/projects/${projectId}/elements`, element)
  return response.data
}

// Agent 段落管理
export async function addAgentSegment(
  projectId: string,
  segment: {
    segmentId: string
    name: string
    description: string
  }
): Promise<AgentSegment> {
  const response = await api.post(`/api/agent/projects/${projectId}/segments`, segment)
  return response.data
}

// Agent 镜头管理
export async function addAgentShot(
  projectId: string,
  shot: {
    segmentId: string
    shotId: string
    name: string
    shotType: string
    description: string
    prompt: string
    narration: string
    duration?: number
  }
): Promise<AgentShot> {
  const response = await api.post(`/api/agent/projects/${projectId}/shots`, shot)
  return response.data
}

// 收藏元素图片
export async function favoriteElementImage(
  projectId: string,
  elementId: string,
  imageId: string
): Promise<{ success: boolean; element: AgentElement }> {
  const response = await api.post(`/api/agent/projects/${projectId}/elements/${elementId}/favorite`, {
    imageId
  })
  return response.data
}

// 收藏镜头起始帧
export async function favoriteShotImage(
  projectId: string,
  shotId: string,
  imageId: string
): Promise<{ success: boolean; shot?: AgentShot }> {
  const response = await api.post(`/api/agent/projects/${projectId}/shots/${shotId}/favorite`, {
    imageId
  })
  return response.data
}

// ========== Agent 批量生成 API ==========

export interface GenerationResult {
  success: boolean
  generated: number
  failed: number
  total: number
  results: Array<{
    element_id?: string
    shot_id?: string
    status: string
    image_url?: string
    source_url?: string
    video_url?: string
    task_id?: string
    error?: string
    message?: string
  }>
}

export interface PipelineResult {
  success: boolean
  stages: {
    elements?: GenerationResult
    frames?: GenerationResult
    videos?: GenerationResult
  }
  total_generated: number
  total_failed: number
  cancelled_at?: string
}

export interface ProjectStatus {
  elements: { total: number; completed: number; pending: number }
  frames: { total: number; completed: number; pending: number }
  videos: { total: number; completed: number; processing: number; pending: number }
  overall_progress: {
    elements_percent: number
    frames_percent: number
    videos_percent: number
  }
}

// 流式生成事件类型
export interface GenerateStreamEvent {
  type: 'start' | 'generating' | 'complete' | 'skip' | 'error' | 'done'
  element_id?: string
  element_name?: string
  image_url?: string
  source_url?: string
  image_id?: string
  current?: number
  total?: number
  generated?: number
  failed?: number
  error?: string
}

// 批量生成元素图片
export async function generateProjectElements(
  projectId: string,
  visualStyle: string = '吉卜力动画风格'
): Promise<GenerationResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/generate-elements`, {
    visualStyle
  }, {
    timeout: 600000 // 10分钟超时，用于批量生成
  })
  return response.data
}

// 流式生成元素图片 (SSE)
export function generateProjectElementsStream(
  projectId: string,
  visualStyle: string = '吉卜力动画风格',
  onEvent: (event: GenerateStreamEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const url = `${API_BASE}/api/agent/projects/${projectId}/generate-elements-stream?visualStyle=${encodeURIComponent(visualStyle)}`
  
  const eventSource = new EventSource(url)
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as GenerateStreamEvent
      onEvent(data)
      
      // 如果完成，关闭连接
      if (data.type === 'done') {
        eventSource.close()
      }
    } catch (e) {
      console.error('解析 SSE 事件失败:', e)
    }
  }
  
  eventSource.onerror = (error) => {
    console.error('SSE 连接错误:', error)
    eventSource.close()
    onError?.(new Error('连接中断'))
  }
  
  // 返回取消函数
  return () => {
    eventSource.close()
  }
}

// 批量生成起始帧
export async function generateProjectFrames(
  projectId: string,
  visualStyle: string = '吉卜力动画风格'
): Promise<GenerationResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/generate-frames`, {
    visualStyle
  }, {
    timeout: 600000 // 10分钟超时
  })
  return response.data
}

// 起始帧流式生成事件类型
export interface FrameStreamEvent {
  type: 'start' | 'skip' | 'generating' | 'complete' | 'error' | 'done'
  shot_id?: string
  shot_name?: string
  image_url?: string
  source_url?: string
  image_id?: string
  current?: number
  total?: number
  generated?: number
  failed?: number
  skipped?: number
  percent?: number
  stage?: 'prompt' | 'image'
  reference_count?: number
  error?: string
  reason?: string
}

// 流式生成起始帧 (SSE)
export function generateProjectFramesStream(
  projectId: string,
  visualStyle: string = '吉卜力动画风格',
  onEvent: (event: FrameStreamEvent) => void,
  onError?: (error: Error) => void,
  options?: { excludeShotIds?: string[]; mode?: 'missing' | 'regenerate' }
): () => void {
  const params = new URLSearchParams()
  params.set('visualStyle', visualStyle)
  const excludeShotIds = options?.excludeShotIds?.filter(Boolean) || []
  if (excludeShotIds.length > 0) {
    params.set('excludeShotIds', excludeShotIds.join(','))
  }
  if (options?.mode) {
    params.set('mode', options.mode)
  }
  const url = `${API_BASE}/api/agent/projects/${projectId}/generate-frames-stream?${params.toString()}`

  const eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as FrameStreamEvent
      onEvent(data)

      // 如果完成，关闭连接
      if (data.type === 'done') {
        eventSource.close()
      }
    } catch (e) {
      console.error('解析 SSE 事件失败:', e)
    }
  }

  eventSource.onerror = (error) => {
    console.error('SSE 连接错误:', error)
    eventSource.close()
    onError?.(new Error('连接中断'))
  }

  // 返回取消函数
  return () => {
    eventSource.close()
  }
}

// 重新生成单个镜头的起始帧（带角色参考图）
export interface RegenerateShotFrameResult {
  success: boolean
  shot_id: string
  image_url?: string
  source_url?: string
  image_id?: string
  start_image_url?: string
  cached_start_image_url?: string
  start_image_history?: ShotImageHistory[]
  reference_images_count?: number
  error?: string
}

export async function regenerateShotFrame(
  projectId: string,
  shotId: string,
  visualStyle: string = '吉卜力动画风格'
): Promise<RegenerateShotFrameResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/shots/${shotId}/regenerate-frame`, {
    visualStyle
  }, {
    timeout: 300000 // 5分钟超时
  })
  return response.data
}

// 批量生成视频
export async function generateProjectVideos(
  projectId: string,
  resolution: string = '720p'
): Promise<GenerationResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/generate-videos`, {
    resolution
  }, {
    timeout: 1800000 // 30分钟超时，视频生成更慢
  })
  return response.data
}

// 视频流式生成事件类型
export interface VideoStreamEvent {
  type: 'start' | 'skip' | 'submitting' | 'submitted' | 'complete' | 'error' | 'polling_start' | 'polling' | 'timeout' | 'done'
  shot_id?: string
  shot_name?: string
  task_id?: string
  video_url?: string
  current?: number
  total?: number
  submitted?: number
  completed?: number
  failed?: number
  skipped?: number
  pending?: number
  percent?: number
  phase?: 'submit' | 'poll'
  elapsed?: number
  message?: string
  error?: string
}

// 流式生成视频 (SSE)
export function generateProjectVideosStream(
  projectId: string,
  resolution: string = '720p',
  onEvent: (event: VideoStreamEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const url = `${API_BASE}/api/agent/projects/${projectId}/generate-videos-stream?resolution=${encodeURIComponent(resolution)}`

  const eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as VideoStreamEvent
      onEvent(data)

      // 如果完成或超时，关闭连接
      if (data.type === 'done' || data.type === 'timeout') {
        eventSource.close()
      }
    } catch (e) {
      console.error('解析 SSE 事件失败:', e)
    }
  }

  eventSource.onerror = (error) => {
    console.error('SSE 连接错误:', error)
    eventSource.close()
    onError?.(new Error('连接中断'))
  }

  // 返回取消函数
  return () => {
    eventSource.close()
  }
}

// Agent：生成旁白/对白音频（独立 TTS）
export async function generateAgentAudio(
  projectId: string,
  options?: {
    overwrite?: boolean
    includeNarration?: boolean
    includeDialogue?: boolean
    shotIds?: string[]
  }
): Promise<{ success: boolean; generated: number; skipped: number; failed: number; results: Array<Record<string, unknown>> }> {
  const response = await api.post(`/api/agent/projects/${projectId}/generate-audio`, {
    overwrite: options?.overwrite ?? false,
    includeNarration: options?.includeNarration ?? true,
    includeDialogue: options?.includeDialogue ?? true,
    shotIds: options?.shotIds
  }, {
    timeout: 1800000 // 30分钟：批量音频可能较慢
  })
  return response.data
}

export async function clearAgentAudio(
  projectId: string,
  options?: {
    shotIds?: string[]
    deleteFiles?: boolean
  }
): Promise<{ success: boolean; cleared_shots: number; removed_assets: number; deleted_files: number }> {
  const response = await api.post(`/api/agent/projects/${projectId}/clear-audio`, {
    shotIds: options?.shotIds,
    deleteFiles: options?.deleteFiles ?? true
  })
  return response.data
}

// 执行完整流程
export async function executeProjectPipeline(
  projectId: string,
  visualStyle: string = '吉卜力动画风格',
  resolution: string = '720p'
): Promise<PipelineResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/execute-pipeline`, {
    visualStyle,
    resolution
  }, {
    timeout: 3600000 // 1小时超时，完整流程
  })
  return response.data
}

// 执行完整流程（音频先行约束版；后端会自动退化为旧行为）
export async function executeProjectPipelineV2(
  projectId: string,
  visualStyle: string = '吉卜力动画风格',
  resolution: string = '720p',
  options?: { forceRegenerateVideos?: boolean }
): Promise<PipelineResult> {
  const response = await api.post(`/api/agent/projects/${projectId}/execute-pipeline-v2`, {
    visualStyle,
    resolution,
    forceRegenerateVideos: options?.forceRegenerateVideos ?? false
  }, {
    timeout: 3600000 // 1小时超时，完整流程
  })
  return response.data
}

export async function getAgentAudioTimeline(projectId: string): Promise<{ success: boolean; audio_timeline: AudioTimeline }> {
  const response = await api.get(`/api/agent/projects/${projectId}/audio-timeline`)
  return response.data
}

export async function saveAgentAudioTimeline(
  projectId: string,
  audioTimeline: AudioTimeline,
  options?: { applyToProject?: boolean; resetVideos?: boolean }
): Promise<{ success: boolean; project: AgentProject; audio_timeline: AudioTimeline }> {
  const response = await api.post(`/api/agent/projects/${projectId}/audio-timeline`, {
    audioTimeline,
    applyToProject: options?.applyToProject ?? true,
    resetVideos: options?.resetVideos ?? true,
  })
  return response.data
}

export async function generateAudioTimelineMasterAudio(
  projectId: string,
  shotDurations: Record<string, number>
): Promise<{ success: boolean; master_audio_url: string; duration_ms: number }> {
  const response = await api.post(`/api/agent/projects/${projectId}/audio-timeline/master-audio`, {
    shotDurations
  }, {
    timeout: 300000
  })
  return response.data
}

// 获取项目生成状态
export async function getProjectGenerationStatus(projectId: string): Promise<ProjectStatus> {
  const response = await api.get(`/api/agent/projects/${projectId}/status`)
  return response.data
}

// ========== 自定义配置预设 ==========

export interface CustomProvider {
  id: string
  name: string
  category: 'llm' | 'image' | 'storyboard' | 'video' | 'tts'
  isCustom: boolean
  apiKey: string
  baseUrl: string
  model: string
  models: string[]
  created_at: string
  updated_at: string
}

export async function listCustomProviders(
  category?: string
): Promise<CustomProvider[]> {
  const response = await api.get('/api/custom-providers', {
    params: category ? { category } : {}
  })
  return response.data.providers
}

export async function addCustomProvider(
  name: string,
  category: string,
  config: {
    apiKey?: string
    baseUrl?: string
    model?: string
    models?: string[]
  }
): Promise<CustomProvider> {
  const response = await api.post('/api/custom-providers', {
    name,
    category,
    ...config
  })
  return response.data
}

export async function updateCustomProvider(
  providerId: string,
  updates: {
    name?: string
    apiKey?: string
    baseUrl?: string
    model?: string
    models?: string[]
  }
): Promise<CustomProvider> {
  const response = await api.put(`/api/custom-providers/${providerId}`, updates)
  return response.data
}

export async function deleteCustomProvider(providerId: string): Promise<void> {
  await api.delete(`/api/custom-providers/${providerId}`)
}

// ========== Agent Video Task Polling ==========

// Poll pending video tasks for a project (updates backend project YAML)
export async function pollProjectVideoTasks(projectId: string): Promise<{
  success: boolean
  checked: number
  completed: number
  failed: number
  processing: number
  updated: Array<Record<string, unknown>>
}> {
  const response = await api.post(`/api/agent/projects/${projectId}/poll-video-tasks`)
  return response.data
}
