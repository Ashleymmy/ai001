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
  local: {
    enabled: boolean
    comfyuiUrl: string
    sdWebuiUrl: string
    vramStrategy: string
  }
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
    seed: options?.seed
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
