import { FileText, Film, Image, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ModuleCard = {
  id: 'script' | 'image' | 'storyboard' | 'video'
  name: string
  description: string
  icon: LucideIcon
  gradient: string
  shadow: string
  path: string
}

export const MODULE_CARDS: ModuleCard[] = [
  {
    id: 'script',
    name: '剧本创作',
    description: '创作和编辑剧本、故事大纲',
    icon: FileText,
    gradient: 'from-violet-500 to-purple-400',
    shadow: 'shadow-violet-500/30',
    path: '/home/script'
  },
  {
    id: 'image',
    name: '图像生成',
    description: '生成和编辑 AI 图像',
    icon: Image,
    gradient: 'from-pink-500 to-rose-400',
    shadow: 'shadow-pink-500/30',
    path: '/home/image'
  },
  {
    id: 'storyboard',
    name: '分镜制作',
    description: '将剧本转化为分镜画面',
    icon: Film,
    gradient: 'from-orange-500 to-amber-400',
    shadow: 'shadow-orange-500/30',
    path: '/home/storyboard'
  },
  {
    id: 'video',
    name: '视频生成',
    description: '将分镜图片生成视频',
    icon: Video,
    gradient: 'from-emerald-500 to-teal-400',
    shadow: 'shadow-emerald-500/30',
    path: '/home/video'
  }
]

