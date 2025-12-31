import { create } from 'zustand'

export interface Storyboard {
  id: string
  prompt: string
  imageUrl: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
}

export interface Project {
  id: string
  name: string
  referenceImage: string | null
  storyText: string
  storyboards: Storyboard[]
  style: string
  createdAt: string
  updatedAt: string
}

interface ProjectState {
  currentProject: Project | null
  recentProjects: Project[]
  
  // Actions
  createProject: () => void
  setReferenceImage: (url: string) => void
  setStoryText: (text: string) => void
  setStyle: (style: string) => void
  addStoryboard: (storyboard: Storyboard) => void
  updateStoryboard: (id: string, updates: Partial<Storyboard>) => void
  removeStoryboard: (id: string) => void
  clearStoryboards: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  recentProjects: [],

  createProject: () => {
    const newProject: Project = {
      id: Date.now().toString(),
      name: '未命名项目',
      referenceImage: null,
      storyText: '',
      storyboards: [],
      style: 'cinematic',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    set({ currentProject: newProject })
  },

  setReferenceImage: (url) =>
    set((state) => ({
      currentProject: state.currentProject
        ? { ...state.currentProject, referenceImage: url }
        : null
    })),

  setStoryText: (text) =>
    set((state) => ({
      currentProject: state.currentProject
        ? { ...state.currentProject, storyText: text }
        : null
    })),

  setStyle: (style) =>
    set((state) => ({
      currentProject: state.currentProject
        ? { ...state.currentProject, style }
        : null
    })),

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
