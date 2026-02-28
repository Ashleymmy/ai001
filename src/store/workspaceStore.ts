/**
 * 功能模块：状态管理模块，负责 workspaceStore 相关业务状态与动作编排
 */

import { create } from 'zustand'
import {
  authChangePassword,
  authGetConfig,
  authForgotPassword,
  authLogin,
  authLogout,
  authMe,
  authRefresh,
  authRegister,
  authResetPassword,
  authUpdateMe,
  getStoredAccessToken,
  getStoredRefreshToken,
  getStoredWorkspaceId,
  setStoredAuthTokens,
  clearStoredAuthTokens,
  setStoredWorkspaceId,
  workspaceCreate,
  workspaceList,
  workspaceListMembers,
  workspaceListOkrs,
  workspaceCreateOkr,
  workspaceUpdateOkr,
  type CollabUser,
  type WorkspaceSummary,
  type WorkspaceMember,
  type OkrObjective,
  type OkrKeyResult,
  type OkrLink,
} from '../services/api'

interface WorkspaceState {
  initialized: boolean
  loading: boolean
  authRequired: boolean
  user: CollabUser | null
  workspaces: WorkspaceSummary[]
  currentWorkspaceId: string
  members: WorkspaceMember[]
  okrs: OkrObjective[]
  error: string | null

  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (payload: { name?: string; email?: string }) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  forgotPassword: (email: string) => Promise<string>
  resetPassword: (resetToken: string, newPassword: string) => Promise<void>

  setCurrentWorkspaceId: (workspaceId: string) => void
  refreshWorkspaces: () => Promise<void>

  loadMembers: (workspaceId?: string) => Promise<void>
  loadOkrs: (workspaceId?: string) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  createOkr: (payload: {
    title: string
    owner_user_id?: string
    status?: string
    risk?: string
    due_date?: string
    key_results?: OkrKeyResult[]
    links?: OkrLink[]
  }) => Promise<void>
  updateOkr: (okrId: string, updates: Partial<{
    title: string
    owner_user_id: string
    status: string
    risk: string
    due_date: string
    key_results: OkrKeyResult[]
    links: OkrLink[]
  }>) => Promise<void>

  clearError: () => void
}

function pickWorkspaceId(workspaces: WorkspaceSummary[], preferred: string): string {
  if (preferred && workspaces.some((ws) => ws.id === preferred)) return preferred
  return workspaces[0]?.id || ''
}

async function tryLoadMe(): Promise<{ user: CollabUser; workspaces: WorkspaceSummary[] } | null> {
  try {
    return await authMe()
  } catch {
    return null
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  initialized: false,
  loading: false,
  authRequired: false,
  user: null,
  workspaces: [],
  currentWorkspaceId: '',
  members: [],
  okrs: [],
  error: null,

  init: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      let authRequired = false
      try {
        const config = await authGetConfig()
        authRequired = Boolean(config.auth_required)
      } catch {
        authRequired = false
      }

      const access = getStoredAccessToken()
      const refresh = getStoredRefreshToken()
      let me = await tryLoadMe()

      if (!me && refresh) {
        try {
          const next = await authRefresh(refresh)
          setStoredAuthTokens(next.access_token, next.refresh_token)
          me = await tryLoadMe()
        } catch {
          clearStoredAuthTokens()
        }
      }

      if (!me && authRequired && !access) {
        set({
          authRequired,
          initialized: true,
          loading: false,
          user: null,
          workspaces: [],
          currentWorkspaceId: '',
        })
        return
      }

      const fallbackWorkspaces = me?.workspaces || []
      const preferredWorkspace = getStoredWorkspaceId()
      const workspaceId = pickWorkspaceId(fallbackWorkspaces, preferredWorkspace)
      setStoredWorkspaceId(workspaceId)

      set({
        authRequired,
        initialized: true,
        loading: false,
        user: me?.user || null,
        workspaces: fallbackWorkspaces,
        currentWorkspaceId: workspaceId,
      })

      if (workspaceId) {
        await Promise.all([get().loadMembers(workspaceId), get().loadOkrs(workspaceId)])
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '初始化协作上下文失败'
      set({ loading: false, initialized: true, error: message })
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const result = await authLogin({ email, password })
      setStoredAuthTokens(result.access_token, result.refresh_token)
      const preferredWorkspace = getStoredWorkspaceId()
      const workspaceId = pickWorkspaceId(result.workspaces, preferredWorkspace)
      setStoredWorkspaceId(workspaceId)
      set({
        loading: false,
        user: result.user,
        workspaces: result.workspaces,
        currentWorkspaceId: workspaceId,
      })
      if (workspaceId) {
        await Promise.all([get().loadMembers(workspaceId), get().loadOkrs(workspaceId)])
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '登录失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  register: async (name, email, password) => {
    set({ loading: true, error: null })
    try {
      const result = await authRegister({ name, email, password })
      setStoredAuthTokens(result.access_token, result.refresh_token)
      const workspace = result.workspace
      const nextWorkspaceId = workspace?.id || ''
      setStoredWorkspaceId(nextWorkspaceId)
      set({
        loading: false,
        user: result.user,
        workspaces: workspace ? [workspace] : [],
        currentWorkspaceId: nextWorkspaceId,
      })
      if (nextWorkspaceId) {
        await Promise.all([get().loadMembers(nextWorkspaceId), get().loadOkrs(nextWorkspaceId)])
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '注册失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  logout: async () => {
    set({ loading: true, error: null })
    try {
      const refresh = getStoredRefreshToken()
      if (refresh) {
        try {
          await authLogout(refresh)
        } catch {
          // ignore logout failure
        }
      }
      clearStoredAuthTokens()
      setStoredWorkspaceId('')
      set({
        loading: false,
        user: null,
        workspaces: [],
        currentWorkspaceId: '',
        members: [],
        okrs: [],
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : '退出失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  updateProfile: async (payload) => {
    set({ loading: true, error: null })
    try {
      const result = await authUpdateMe(payload)
      const preferredWorkspace = get().currentWorkspaceId || getStoredWorkspaceId()
      const workspaceId = pickWorkspaceId(result.workspaces, preferredWorkspace)
      setStoredWorkspaceId(workspaceId)
      set({
        loading: false,
        user: result.user,
        workspaces: result.workspaces,
        currentWorkspaceId: workspaceId,
      })
      if (workspaceId) {
        await Promise.all([get().loadMembers(workspaceId), get().loadOkrs(workspaceId)])
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '更新资料失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    set({ loading: true, error: null })
    try {
      await authChangePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      set({ loading: false })
    } catch (e) {
      const message = e instanceof Error ? e.message : '修改密码失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  forgotPassword: async (email) => {
    set({ loading: true, error: null })
    try {
      const result = await authForgotPassword({ email })
      set({ loading: false })
      return String(result.reset_token || '')
    } catch (e) {
      const message = e instanceof Error ? e.message : '发送重置请求失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  resetPassword: async (resetToken, newPassword) => {
    set({ loading: true, error: null })
    try {
      await authResetPassword({
        reset_token: resetToken,
        new_password: newPassword,
      })
      set({ loading: false })
    } catch (e) {
      const message = e instanceof Error ? e.message : '重置密码失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  setCurrentWorkspaceId: (workspaceId) => {
    const next = (workspaceId || '').trim()
    setStoredWorkspaceId(next)
    set({ currentWorkspaceId: next })
    if (next) {
      void Promise.all([get().loadMembers(next), get().loadOkrs(next)])
    }
  },

  refreshWorkspaces: async () => {
    const list = await workspaceList()
    const preferred = get().currentWorkspaceId || getStoredWorkspaceId()
    const nextWorkspaceId = pickWorkspaceId(list, preferred)
    setStoredWorkspaceId(nextWorkspaceId)
    set({ workspaces: list, currentWorkspaceId: nextWorkspaceId })
  },

  loadMembers: async (workspaceId) => {
    const target = workspaceId || get().currentWorkspaceId
    if (!target) {
      set({ members: [] })
      return
    }
    try {
      const members = await workspaceListMembers(target)
      set({ members })
    } catch (e) {
      const message = e instanceof Error ? e.message : '加载成员失败'
      set({ error: message })
    }
  },

  loadOkrs: async (workspaceId) => {
    const target = workspaceId || get().currentWorkspaceId
    if (!target) {
      set({ okrs: [] })
      return
    }
    try {
      const okrs = await workspaceListOkrs(target)
      set({ okrs })
    } catch (e) {
      const message = e instanceof Error ? e.message : '加载 OKR 失败'
      set({ error: message })
    }
  },

  createWorkspace: async (name) => {
    const created = await workspaceCreate(name)
    await get().refreshWorkspaces()
    setStoredWorkspaceId(created.id)
    set({ currentWorkspaceId: created.id })
    await Promise.all([get().loadMembers(created.id), get().loadOkrs(created.id)])
  },

  createOkr: async (payload) => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return
    await workspaceCreateOkr(workspaceId, payload)
    await get().loadOkrs(workspaceId)
  },

  updateOkr: async (okrId, updates) => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return
    await workspaceUpdateOkr(workspaceId, okrId, updates)
    await get().loadOkrs(workspaceId)
  },

  clearError: () => set({ error: null }),
}))
