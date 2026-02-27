/**
 * WorkspaceDashboardPage — 协作 Dashboard 页面
 *
 * 左侧：成员列表 + 在线状态
 * 中间：Episode 分配看板（按 status 分列）
 * 右侧：审核队列（submitted 状态的分配）
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Circle, ArrowLeft, CheckCircle, XCircle,
  FileText, AlertCircle, Loader2, RefreshCw,
} from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useStudioStore } from '../store/studioStore'
import { useWorkspaceWebSocket } from '../hooks/useWorkspaceWebSocket'
import type { OnlineMember } from '../hooks/useWorkspaceWebSocket'
import type { EpisodeAssignment, StudioSeries } from '../services/api'
import { studioListSeries, listOnlineMembers } from '../services/api'

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  draft: '编辑中',
  submitted: '待审核',
  approved: '已批准',
  rejected: '已退回',
}

const ASSIGNMENT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-700 border-blue-200',
  submitted: 'bg-amber-100 text-amber-700 border-amber-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
}

export default function WorkspaceDashboardPage() {
  const navigate = useNavigate()

  const {
    initialized,
    loading: wsLoading,
    user,
    currentWorkspaceId,
    members,
    init,
    loadMembers,
  } = useWorkspaceStore((s) => ({
    initialized: s.initialized,
    loading: s.loading,
    user: s.user,
    currentWorkspaceId: s.currentWorkspaceId,
    members: s.members,
    init: s.init,
    loadMembers: s.loadMembers,
  }))

  const {
    episodeAssignments,
    episodeAssignmentsLoading,
    onlineMembers,
    loadEpisodeAssignments,
    reviewEpisodeAssignment,
    setOnlineMembers,
  } = useStudioStore((s) => ({
    episodeAssignments: s.episodeAssignments,
    episodeAssignmentsLoading: s.episodeAssignmentsLoading,
    onlineMembers: s.onlineMembers,
    loadEpisodeAssignments: s.loadEpisodeAssignments,
    reviewEpisodeAssignment: s.reviewEpisodeAssignment,
    setOnlineMembers: s.setOnlineMembers,
  }))

  const [seriesList, setSeriesList] = useState<StudioSeries[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // Initialize workspace
  useEffect(() => {
    if (!initialized) init()
  }, [initialized, init])

  // Load data when workspace is ready
  useEffect(() => {
    if (!currentWorkspaceId) return
    loadMembers(currentWorkspaceId)
    loadEpisodeAssignments(currentWorkspaceId)
    studioListSeries().then(setSeriesList).catch(() => {})
    listOnlineMembers(currentWorkspaceId).then((m) => setOnlineMembers(m)).catch(() => {})
  }, [currentWorkspaceId, loadMembers, loadEpisodeAssignments, setOnlineMembers])

  // WebSocket for real-time updates
  const handleWSEvent = useCallback(() => {
    if (!currentWorkspaceId) return
    // Refresh assignments on relevant events
    loadEpisodeAssignments(currentWorkspaceId)
  }, [currentWorkspaceId, loadEpisodeAssignments])

  const handleOnlineMembersChange = useCallback((m: OnlineMember[]) => {
    setOnlineMembers(m)
  }, [setOnlineMembers])

  useWorkspaceWebSocket({
    workspaceId: currentWorkspaceId || null,
    enabled: !!currentWorkspaceId,
    onEvent: handleWSEvent,
    onOnlineMembersChange: handleOnlineMembersChange,
  })

  // Build online member set
  const onlineUserIds = useMemo(
    () => new Set(onlineMembers.map((m) => m.user_id)),
    [onlineMembers],
  )

  // Group assignments by status
  const assignmentsByStatus = useMemo(() => {
    const groups: Record<string, EpisodeAssignment[]> = {
      draft: [],
      submitted: [],
      approved: [],
      rejected: [],
    }
    for (const a of episodeAssignments) {
      const bucket = groups[a.status] || groups.draft
      bucket.push(a)
    }
    return groups
  }, [episodeAssignments])

  // Review queue = submitted assignments
  const reviewQueue = assignmentsByStatus.submitted

  // Build series name map
  const seriesNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of seriesList) m[s.id] = s.name
    return m
  }, [seriesList])

  // Refresh all data
  const handleRefresh = useCallback(async () => {
    if (!currentWorkspaceId) return
    setRefreshing(true)
    try {
      await Promise.all([
        loadMembers(currentWorkspaceId),
        loadEpisodeAssignments(currentWorkspaceId),
        studioListSeries().then(setSeriesList),
      ])
    } catch {
      // ignore
    }
    setRefreshing(false)
  }, [currentWorkspaceId, loadMembers, loadEpisodeAssignments])

  // Review actions
  const handleApprove = useCallback(async (episodeId: string) => {
    if (!currentWorkspaceId) return
    await reviewEpisodeAssignment(currentWorkspaceId, episodeId, 'approve')
  }, [currentWorkspaceId, reviewEpisodeAssignment])

  const handleReject = useCallback(async (episodeId: string) => {
    if (!currentWorkspaceId) return
    const note = window.prompt('退回原因（可选）：') || ''
    await reviewEpisodeAssignment(currentWorkspaceId, episodeId, 'reject', note)
  }, [currentWorkspaceId, reviewEpisodeAssignment])

  if (!initialized || wsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        加载中...
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400">
        <button onClick={() => navigate('/auth')} className="text-blue-400 hover:underline">
          请先登录
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 hover:bg-gray-800 rounded text-gray-400"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-semibold">协作 Dashboard</h1>
        <span className="text-sm text-gray-500">
          {members.length} 位成员 · {onlineMembers.length} 在线
        </span>
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Left Panel — Members */}
        <div className="w-64 border-r border-gray-800 bg-gray-900/50 p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            成员列表
          </h2>
          <div className="space-y-2">
            {members.map((m) => {
              const isOnline = onlineUserIds.has(m.user_id)
              return (
                <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800/60">
                  <Circle
                    className={`w-2.5 h-2.5 flex-shrink-0 ${isOnline ? 'fill-green-400 text-green-400' : 'fill-gray-600 text-gray-600'}`}
                  />
                  <span className="text-sm truncate">{m.name || m.email}</span>
                  <span className="text-xs text-gray-500 ml-auto">{m.role}</span>
                </div>
              )
            })}
            {members.length === 0 && (
              <p className="text-sm text-gray-600 italic">暂无成员</p>
            )}
          </div>
        </div>

        {/* Center — Assignment Kanban */}
        <div className="flex-1 overflow-x-auto p-4">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            Episode 分配看板
            {episodeAssignmentsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
          </h2>
          <div className="flex gap-4 min-h-[400px]">
            {(['draft', 'submitted', 'approved', 'rejected'] as const).map((status) => (
              <div key={status} className="flex-1 min-w-[220px]">
                <div className={`text-xs font-medium px-2 py-1 rounded-t border ${ASSIGNMENT_STATUS_COLORS[status]}`}>
                  {ASSIGNMENT_STATUS_LABELS[status]} ({assignmentsByStatus[status].length})
                </div>
                <div className="border border-t-0 border-gray-800 rounded-b bg-gray-900/30 p-2 space-y-2 min-h-[300px]">
                  {assignmentsByStatus[status].map((a) => (
                    <div
                      key={a.episode_id}
                      className="bg-gray-800/80 rounded p-2.5 text-sm border border-gray-700/50 hover:border-gray-600"
                    >
                      <div className="font-medium truncate">{a.episode_id.slice(0, 12)}...</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {seriesNameMap[a.series_id] || a.series_id?.slice(0, 8)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        分配给: {a.assigned_to_name || a.assigned_to?.slice(0, 8)}
                      </div>
                      {a.note && (
                        <div className="text-xs text-gray-500 mt-1 truncate">
                          备注: {a.note}
                        </div>
                      )}
                    </div>
                  ))}
                  {assignmentsByStatus[status].length === 0 && (
                    <p className="text-xs text-gray-600 italic text-center py-8">暂无</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel — Review Queue */}
        <div className="w-72 border-l border-gray-800 bg-gray-900/50 p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            审核队列 ({reviewQueue.length})
          </h2>
          <div className="space-y-3">
            {reviewQueue.map((a) => (
              <div key={a.episode_id} className="bg-gray-800/80 rounded p-3 border border-amber-800/30">
                <div className="text-sm font-medium truncate">{a.episode_id.slice(0, 16)}...</div>
                <div className="text-xs text-gray-400 mt-1">
                  提交人: {a.assigned_to_name || a.assigned_to?.slice(0, 8)}
                </div>
                {a.submitted_at && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    提交于: {new Date(a.submitted_at).toLocaleString()}
                  </div>
                )}
                {a.note && (
                  <div className="text-xs text-gray-500 mt-0.5 truncate">备注: {a.note}</div>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleApprove(a.episode_id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-green-800/40 hover:bg-green-700/50 text-green-300 rounded border border-green-700/40"
                  >
                    <CheckCircle className="w-3 h-3" />
                    批准
                  </button>
                  <button
                    onClick={() => handleReject(a.episode_id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-red-800/40 hover:bg-red-700/50 text-red-300 rounded border border-red-700/40"
                  >
                    <XCircle className="w-3 h-3" />
                    退回
                  </button>
                </div>
              </div>
            ))}
            {reviewQueue.length === 0 && (
              <p className="text-sm text-gray-600 italic text-center py-8">暂无待审核项</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
