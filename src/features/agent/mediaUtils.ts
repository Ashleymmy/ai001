/**
 * AgentPage utility functions: URL handling, payload inspection, session/message helpers.
 */

import { BACKEND_ORIGIN } from '../../services/api'
import type { ChatMessage } from './types'

export function isProbablyExpiredSignedUrl(url?: string | null) {
  const raw = (url || '').trim()
  if (!raw || !/^https?:/i.test(raw)) return false
  try {
    const parsed = new URL(raw)
    const qs = parsed.searchParams

    const tosDate = qs.get('X-Tos-Date')
    const tosExpires = qs.get('X-Tos-Expires')
    if (tosDate && tosExpires) {
      const expiresSeconds = Number.parseInt(tosExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(tosDate.slice(0, 4), 10)
      const month = Number.parseInt(tosDate.slice(4, 6), 10)
      const day = Number.parseInt(tosDate.slice(6, 8), 10)
      const hour = Number.parseInt(tosDate.slice(9, 11), 10)
      const minute = Number.parseInt(tosDate.slice(11, 13), 10)
      const second = Number.parseInt(tosDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }

    const amzDate = qs.get('X-Amz-Date')
    const amzExpires = qs.get('X-Amz-Expires')
    if (amzDate && amzExpires) {
      const expiresSeconds = Number.parseInt(amzExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(amzDate.slice(0, 4), 10)
      const month = Number.parseInt(amzDate.slice(4, 6), 10)
      const day = Number.parseInt(amzDate.slice(6, 8), 10)
      const hour = Number.parseInt(amzDate.slice(9, 11), 10)
      const minute = Number.parseInt(amzDate.slice(11, 13), 10)
      const second = Number.parseInt(amzDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }
  } catch {
    // ignore
  }
  return false
}

export function resolveMediaUrl(url?: string | null) {
  const u = (url || '').trim()
  if (!u) return ''
  if (/^(data:|blob:)/i.test(u)) return u
  if (/^https?:/i.test(u)) return isProbablyExpiredSignedUrl(u) ? '' : u
  if (u.startsWith('/api/')) return `${BACKEND_ORIGIN}${u}`
  return u
}

export function canonicalizeMediaUrl(url: string) {
  const u = (url || '').trim()
  if (!u) return ''
  return u.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?=\/api\/)/i, '')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function unwrapStructuredPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  let obj: Record<string, unknown> = value
  for (const key of ['data', 'result', 'plan', 'patch', 'updates']) {
    const inner = obj[key]
    if (isRecord(inner)) obj = inner
  }
  return obj
}

export function looksLikeAgentPatch(value: unknown): boolean {
  const obj = unwrapStructuredPayload(value)
  if (!obj) return false
  const keys = [
    'elements',
    'segments',
    'creative_brief',
    'creativeBrief',
    'Creative_Brief',
    'Key_Elements',
    'key_elements',
    'Storyboard_With_Prompts',
    'storyboard_with_prompts',
    'Storyboard',
    'storyboard',
    'Character_Designs',
    'character_designs',
    'characterDesigns',
  ]
  return keys.some((k) => k in obj)
}

export function createAgentChatSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function buildInitialAgentMessages(): ChatMessage[] {
  return [
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
        { id: 'example3', label: '教育动画', value: '制作一个2分钟的科普教育动画，解释光合作用' },
      ],
    },
  ]
}
