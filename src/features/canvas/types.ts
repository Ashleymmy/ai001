import type { ElementType } from 'react'

export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script'

export interface CanvasNode {
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
  model?: string
  style?: string
  seed?: number
}

export interface Connection {
  id: string
  fromNode: string
  fromPort: 'output'
  toNode: string
  toPort: 'input'
}

export interface HistoryState {
  nodes: CanvasNode[]
  connections: Connection[]
}

export interface CanvasTemplate {
  id: string
  name: string
  desc: string
  nodes: NodeType[]
}

export interface NodeTypeConfig {
  type: NodeType
  icon: ElementType
  label: string
  desc: string
  gradient: string
}
