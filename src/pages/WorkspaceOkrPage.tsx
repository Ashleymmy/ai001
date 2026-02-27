import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import { studioListSeries } from '../services/api'
import type { StudioSeries } from '../services/api'

export default function WorkspaceOkrPage() {
  const navigate = useNavigate()
  const {
    initialized,
    loading,
    user,
    workspaces,
    currentWorkspaceId,
    okrs,
    error,
    init,
    setCurrentWorkspaceId,
    loadOkrs,
    createWorkspace,
    createOkr,
    updateOkr,
  } = useWorkspaceStore((state) => ({
    initialized: state.initialized,
    loading: state.loading,
    user: state.user,
    workspaces: state.workspaces,
    currentWorkspaceId: state.currentWorkspaceId,
    okrs: state.okrs,
    error: state.error,
    init: state.init,
    setCurrentWorkspaceId: state.setCurrentWorkspaceId,
    loadOkrs: state.loadOkrs,
    createWorkspace: state.createWorkspace,
    createOkr: state.createOkr,
    updateOkr: state.updateOkr,
  }))

  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newObjectiveTitle, setNewObjectiveTitle] = useState('')
  const [newKrTitle, setNewKrTitle] = useState('')
  const [newKrAutoMetric, setNewKrAutoMetric] = useState<'shots_completion' | 'frame_completion' | 'video_completion' | 'audio_completion' | 'episodes_completion'>('shots_completion')
  const [newKrLinkType, setNewKrLinkType] = useState<'workspace' | 'series'>('workspace')
  const [newKrSeriesId, setNewKrSeriesId] = useState('')
  const [workspaceSeries, setWorkspaceSeries] = useState<StudioSeries[]>([])

  useEffect(() => {
    if (!initialized) {
      void init()
    }
  }, [init, initialized])

  useEffect(() => {
    if (initialized && currentWorkspaceId) {
      void loadOkrs(currentWorkspaceId)
    }
  }, [currentWorkspaceId, initialized, loadOkrs])

  useEffect(() => {
    if (!initialized || !currentWorkspaceId) {
      setWorkspaceSeries([])
      return
    }
    studioListSeries()
      .then((list) => {
        setWorkspaceSeries(list || [])
      })
      .catch(() => {
        setWorkspaceSeries([])
      })
  }, [initialized, currentWorkspaceId])

  const currentWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === currentWorkspaceId) || null,
    [currentWorkspaceId, workspaces],
  )

  if (!initialized || loading) {
    return <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-200">加载工作区中...</div>
  }

  if (!user) {
    return <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-200">请先登录</div>
  }

  return (
    <div className="h-screen bg-gray-950 text-gray-100 p-4 overflow-auto">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">工作区 OKR 看板</h1>
            <p className="text-xs text-gray-400">目标与 KR 默认按工作区隔离</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/studio')}
              className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs"
            >
              返回 Studio
            </button>
            <button
              onClick={() => navigate('/auth')}
              className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs"
            >
              账号设置
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-1 border border-gray-800 bg-gray-900/70 rounded-lg p-3 space-y-2">
            <h2 className="text-sm font-medium">工作区</h2>
            <select
              value={currentWorkspaceId}
              onChange={(e) => setCurrentWorkspaceId(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>

            <div className="space-y-1 pt-2">
              <label className="text-xs text-gray-400">新建工作区</label>
              <input
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
                placeholder="工作区名称"
              />
              <button
                onClick={() => {
                  if (!newWorkspaceName.trim()) return
                  void createWorkspace(newWorkspaceName.trim())
                  setNewWorkspaceName('')
                }}
                className="w-full px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-xs"
              >
                创建工作区
              </button>
            </div>

            <div className="pt-2 text-xs text-gray-400">
              当前：{currentWorkspace?.name || '未选择'}
            </div>
          </div>

          <div className="lg:col-span-2 border border-gray-800 bg-gray-900/70 rounded-lg p-3 space-y-3">
            <h2 className="text-sm font-medium">新增 Objective</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                value={newObjectiveTitle}
                onChange={(e) => setNewObjectiveTitle(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
                placeholder="目标标题"
              />
              <input
                value={newKrTitle}
                onChange={(e) => setNewKrTitle(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
                placeholder="首个 KR（可选）"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select
                value={newKrAutoMetric}
                onChange={(e) => setNewKrAutoMetric(e.target.value as typeof newKrAutoMetric)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
              >
                <option value="shots_completion">镜头完成率</option>
                <option value="frame_completion">首帧完成率</option>
                <option value="video_completion">视频完成率</option>
                <option value="audio_completion">音频完成率</option>
                <option value="episodes_completion">分集完成率</option>
              </select>
              <select
                value={newKrLinkType}
                onChange={(e) => setNewKrLinkType(e.target.value as 'workspace' | 'series')}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm"
              >
                <option value="workspace">关联整个工作区</option>
                <option value="series">关联单个系列</option>
              </select>
              <select
                value={newKrSeriesId}
                onChange={(e) => setNewKrSeriesId(e.target.value)}
                disabled={newKrLinkType !== 'series'}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm disabled:opacity-40"
              >
                <option value="">选择系列（可选）</option>
                {workspaceSeries.map((series) => (
                  <option key={series.id} value={series.id}>{series.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                if (!newObjectiveTitle.trim()) return
                const link = newKrLinkType === 'series' && newKrSeriesId
                  ? [{ link_type: 'series' as const, link_id: newKrSeriesId }]
                  : [{ link_type: 'workspace' as const, link_id: currentWorkspaceId }]
                void createOkr({
                  title: newObjectiveTitle.trim(),
                  key_results: newKrTitle.trim()
                    ? [{
                      title: newKrTitle.trim(),
                      metric_target: 100,
                      metric_current: 0,
                      auto_metric: newKrAutoMetric,
                      auto_enabled: true,
                      links: link,
                    }]
                    : [],
                })
                setNewObjectiveTitle('')
                setNewKrTitle('')
              }}
              className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-xs"
            >
              新建 Objective
            </button>

            <div className="space-y-2">
              {okrs.length === 0 && (
                <p className="text-xs text-gray-500">当前工作区暂无 OKR</p>
              )}
              {okrs.map((okr) => (
                <div key={okr.id} className="rounded border border-gray-800 bg-gray-950/70 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{okr.title}</div>
                    <span className="text-xs text-gray-400">进度 {Number(okr.progress || 0).toFixed(1)}%</span>
                  </div>
                  <div className="space-y-1">
                    {(okr.key_results || []).map((kr, index) => (
                      <div key={`${okr.id}-${index}`} className="text-xs text-gray-300 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span>{kr.title}</span>
                          {kr.auto_enabled && kr.auto_metric && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-900/45 text-indigo-200 text-[10px]">
                              自动:{kr.auto_metric}
                            </span>
                          )}
                        </span>
                        <span className="text-gray-500">
                          {Number(kr.metric_current || 0).toFixed(1)}/{kr.metric_target}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        const nextStatus = okr.status === 'archived' ? 'active' : 'archived'
                        void updateOkr(okr.id, { status: nextStatus })
                      }}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
                    >
                      {okr.status === 'archived' ? '恢复' : '归档'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-300 border border-red-800/70 bg-red-900/20 rounded px-3 py-2">{error}</div>
        )}
      </div>
    </div>
  )
}
