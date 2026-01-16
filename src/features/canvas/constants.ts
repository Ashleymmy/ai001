import { FileText, Image as ImageIcon, Music, Type, Video } from 'lucide-react'
import type { CanvasTemplate, NodeTypeConfig } from './types'

export const TEMPLATES: CanvasTemplate[] = [
  { id: 'empty', name: '空白画布', desc: '从零开始', nodes: [] },
  { id: 'story', name: '故事创作', desc: '剧本→分镜→视频', nodes: ['script', 'image', 'video'] },
  { id: 'ad', name: '广告制作', desc: '文案→图片→配音', nodes: ['text', 'image', 'audio'] },
  { id: 'music-video', name: 'MV制作', desc: '歌词→画面→视频', nodes: ['text', 'image', 'video', 'audio'] },
]

export const NODE_TYPES: NodeTypeConfig[] = [
  { type: 'text', icon: Type, label: '文本', desc: '故事、文案、提示词', gradient: 'from-blue-500 to-cyan-500' },
  { type: 'image', icon: ImageIcon, label: '图片', desc: 'AI 图像生成', gradient: 'from-purple-500 to-pink-500' },
  { type: 'video', icon: Video, label: '视频', desc: '图生视频', gradient: 'from-green-500 to-emerald-500' },
  { type: 'audio', icon: Music, label: '音频', desc: '配音、音乐', gradient: 'from-orange-500 to-amber-500' },
  { type: 'script', icon: FileText, label: '剧本', desc: 'AI 剧本创作', gradient: 'from-violet-500 to-purple-500' },
]

