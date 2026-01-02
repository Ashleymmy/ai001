import { create } from 'zustand'
import * as api from '../services/api'

export interface Storyboard {
  id: string
  prompt: string
  fullPrompt?: string
  imageUrl: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
}

export interface Project {
  id: string
  name: string
  description?: string
  referenceImage: string | null
  storyText: string
  storyboards: Storyboard[]
  style: string
  status?: string
  createdAt: string
  updatedAt: string
}

interface ProjectState {
  currentProject: Project | null
  projects: Project[]
  loading: boolean
  
  // API Actions
  fetchProjects: () => Promise<void>
  fetchProject: (id: string) => Promise<Project | null>
  createProject: (name: string, description?: string) => Promise<Project>
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  
  // Local Actions
  setCurrentProject: (project: Project | null) => void
  setReferenceImage: (url: string) => void
  setStoryText: (text: string) => void
  setStyle: (style: string) => void
  addStoryboard: (storyboard: Storyboard) => void
  updateStoryboard: (id: string, updates: Partial<Storyboard>) => void
  removeStoryboard: (id: string) => void
  clearStoryboards: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  projects: [],
  loading: false,

  fetchProjects: async () => {
    set({ loading: true })
    try {
      const projects = await api.listProjects()
      const mapped = projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        referenceImage: p.reference_image || null,
        storyText: p.story_text || '',
        storyboards: (p.storyboards || []).map(sb => ({
          id: sb.id,
          prompt: sb.prompt,
          fullPrompt: sb.full_prompt,
          imageUrl: sb.image_url || null,
          status: sb.status as Storyboard['status']
        })),
        style: p.style || 'cinematic',
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }))
      set({ projects: mapped, loading: false })
    } catch (error) {
      console.error('获取项目列表失败:', error)
      set({ loading: false })
    }
  },

  fetchProject: async (id: string) => {
    try {
      const p = await api.getProject(id)
      const project: Project = {
        id: p.id,
        name: p.name,
        description: p.description,
        referenceImage: p.reference_image || null,
        storyText: p.story_text || '',
        storyboards: (p.storyboards || []).map(sb => ({
          id: sb.id,
          prompt: sb.prompt,
          fullPrompt: sb.full_prompt,
          imageUrl: sb.image_url || null,
          status: sb.status as Storyboard['status']
        })),
        style: p.style || 'cinematic',
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }
      set({ currentProject: project })
      return project
    } catch (error) {
      console.error('获取项目详情失败:', error)
      return null
    }
  },

  createProject: async (name: string, description = '') => {
    const p = await api.createProject(name, description)
    const project: Project = {
      id: p.id,
      name: p.name,
      description: p.description,
      referenceImage: null,
      storyText: '',
      storyboards: [],
      style: 'cinematic',
      createdAt: p.created_at,
      updatedAt: p.updated_at
    }
    set(state => ({ 
      projects: [project, ...state.projects],
      currentProject: project
    }))
    return project
  },

  updateProject: async (id: string, updates: Partial<Project>) => {
    const apiUpdates: Record<string, unknown> = {}
    if (updates.name !== undefined) apiUpdates.name = updates.name
    if (updates.description !== undefined) apiUpdates.description = updates.description
    if (updates.referenceImage !== undefined) apiUpdates.reference_image = updates.referenceImage
    if (updates.storyText !== undefined) apiUpdates.story_text = updates.storyText
    if (updates.style !== undefined) apiUpdates.style = updates.style
    if (updates.status !== undefined) apiUpdates.status = updates.status

    await api.updateProject(id, apiUpdates)
    
    set(state => ({
      projects: state.projects.map(p => p.id === id ? { ...p, ...updates } : p),
      currentProject: state.currentProject?.id === id 
        ? { ...state.currentProject, ...updates }
        : state.currentProject
    }))
  },

  deleteProject: async (id: string) => {
    await api.deleteProject(id)
    set(state => ({
      projects: state.projects.filter(p => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject
    }))
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  setReferenceImage: (url) => {
    const { currentProject, updateProject } = get()
    if (currentProject) {
      set({ currentProject: { ...currentProject, referenceImage: url } })
      updateProject(currentProject.id, { referenceImage: url }).catch(console.error)
    }
  },

  setStoryText: (text) => {
    const { currentProject, updateProject } = get()
    if (currentProject) {
      set({ currentProject: { ...currentProject, storyText: text } })
      updateProject(currentProject.id, { storyText: text }).catch(console.error)
    }
  },

  setStyle: (style) => {
    const { currentProject, updateProject } = get()
    if (currentProject) {
      set({ currentProject: { ...currentProject, style } })
      updateProject(currentProject.id, { style }).catch(console.error)
    }
  },

  addStoryboard: (storyboard) =>
    set((state) => ({
      currentProject: state.currentProject
        ? {
            ...state.currentProject,
            storyboards: [...state.currentProject.storyboards, storyboard]
          }
        : null
    })),

  updateStoryboard: (id, updates) =>
    set((state) => ({
      currentProject: state.currentProject
        ? {
            ...state.currentProject,
            storyboards: state.currentProject.storyboards.map((sb) =>
              sb.id === id ? { ...sb, ...updates } : sb
            )
          }
        : null
    })),

  removeStoryboard: (id) =>
    set((state) => ({
      currentProject: state.currentProject
        ? {
            ...state.currentProject,
            storyboards: state.currentProject.storyboards.filter(
              (sb) => sb.id !== id
            )
          }
        : null
    })),

  clearStoryboards: () =>
    set((state) => ({
      currentProject: state.currentProject
        ? {
            ...state.currentProject,
            storyboards: []
          }
        : null
    }))
}))
