/**
 * 功能模块：页面模块，负责 WorkspaceOkrPage 场景的页面布局与交互编排
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import { studioListSeries } from '../services/api'
import type { StudioSeries, OkrObjective } from '../services/api'

/** CSV 导出：目标 + 关键结果 */
function exportOkrToCsv(objectives: OkrObjective[]) {
  const BOM = '\uFEFF'
  const header = '目标名称,状态,进度%,关键结果,KR进度%,截止日期,风险状态'
  const rows: string[] = []
  for (const obj of objectives) {
    const escTitle = `"${(obj.title || '').replace(/"/g, '""')}"`
    const status = obj.status || 'active'
    const progress = Number(obj.progress || 0).toFixed(1)
    const dueDate = obj.due_date || ''
    const risk = obj.risk || ''
    const krs = obj.key_results || []
    if (krs.length === 0) {
      rows.push(`${escTitle},${status},${progress},,,,${risk}`)
    } else {
      for (const kr of krs) {
        const escKr = `"${(kr.title || '').replace(/"/g, '""')}"`
        const krTarget = kr.metric_target || 100
        const krProgress = krTarget > 0
          ? Number((kr.metric_current / krTarget) * 100).toFixed(1)
          : '0.0'
        rows.push(`${escTitle},${status},${progress},${escKr},${krProgress},${dueDate},${risk}`)
      }
    }
  }
  const csv = BOM + header + '\n' + rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const today = new Date().toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = url
  a.download = `okr_report_${today}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 甘特图状态颜色 */
const GANTT_STATUS_COLORS: Record<string, { bar: string; fill: string; text: string }> = {
  active:    { bar: 'rgba(59,130,246,0.25)',  fill: 'rgb(59,130,246)',   text: 'text-blue-300' },
  at_risk:   { bar: 'rgba(245,158,11,0.25)',  fill: 'rgb(245,158,11)',   text: 'text-amber-300' },
  'at-risk': { bar: 'rgba(245,158,11,0.25)',  fill: 'rgb(245,158,11)',   text: 'text-amber-300' },
  completed: { bar: 'rgba(34,197,94,0.25)',   fill: 'rgb(34,197,94)',    text: 'text-green-300' },
  archived:  { bar: 'rgba(156,163,175,0.2)',  fill: 'rgb(156,163,175)',  text: 'text-gray-400' },
}
const DEFAULT_GANTT_COLOR = GANTT_STATUS_COLORS.active

/** 甘特图时间线内联组件 */
function GanttTimeline({ objectives }: { objectives: OkrObjective[] }) {
  if (objectives.length === 0) {
    return <p className="text-xs text-gray-500 py-2">暂无 OKR 数据</p>
  }

  // 确定时间范围：取所有目标/KR 的日期范围，无日期时用 created_at/updated_at
  const now = new Date()
  let globalStart = Infinity
  let globalEnd = -Infinity

  const entries: {
    id: string
    title: string
    status: string
    progress: number
    start: number
    end: number
    isKr: boolean
  }[] = []

  for (const obj of objectives) {
    const objCreated = new Date(obj.created_at).getTime()
    const objDue = obj.due_date ? new Date(obj.due_date).getTime() : now.getTime() + 30 * 86400000
    const objStart = objCreated
    const objEnd = objDue

    entries.push({
      id: obj.id,
      title: obj.title,
      status: obj.status || 'active',
      progress: Number(obj.progress || 0),
      start: objStart,
      end: objEnd,
      isKr: false,
    })

    if (objStart < globalStart) globalStart = objStart
    if (objEnd > globalEnd) globalEnd = objEnd

    for (const kr of obj.key_results || []) {
      const krTarget = kr.metric_target || 100
      const krProgress = krTarget > 0 ? (kr.metric_current / krTarget) * 100 : 0
      entries.push({
        id: `${obj.id}-kr-${kr.id || kr.title}`,
        title: kr.title,
        status: obj.status || 'active',
        progress: krProgress,
        start: objStart,
        end: objEnd,
        isKr: true,
      })
    }
  }

  // 安全范围保底
  if (!isFinite(globalStart)) globalStart = now.getTime() - 30 * 86400000
  if (!isFinite(globalEnd)) globalEnd = now.getTime() + 30 * 86400000
  const totalSpan = Math.max(globalEnd - globalStart, 86400000) // 至少 1 天

  // 月份刻度标记
  const monthMarkers: { label: string; pct: number }[] = []
  const cursor = new Date(globalStart)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  if (cursor.getTime() < globalStart) cursor.setMonth(cursor.getMonth() + 1)
  while (cursor.getTime() <= globalEnd) {
    const pct = ((cursor.getTime() - globalStart) / totalSpan) * 100
    monthMarkers.push({ label: `${cursor.getMonth() + 1}月`, pct })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  // "今天"标记
  const todayPct = ((now.getTime() - globalStart) / totalSpan) * 100
  const showToday = todayPct >= 0 && todayPct <= 100

  return (
    <div className="border border-gray-800 bg-gray-900/70 rounded-lg p-3 space-y-1 overflow-x-auto">
      <h3 className="text-xs font-medium text-gray-300 mb-2">甘特图时间线</h3>

      {/* 月份刻度尺 */}
      <div className="relative h-5 mb-1" style={{ minWidth: 600 }}>
        {monthMarkers.map((m, i) => (
          <span
            key={i}
            className="absolute text-[10px] text-gray-500 -translate-x-1/2"
            style={{ left: `${m.pct}%`, top: 0 }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* 条形区域 */}
      <div className="relative" style={{ minWidth: 600 }}>
        {showToday && (
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10"
            style={{ left: `${todayPct}%` }}
            title="今天"
          />
        )}
        {entries.map((entry) => {
          const leftPct = ((entry.start - globalStart) / totalSpan) * 100
          const widthPct = Math.max(((entry.end - entry.start) / totalSpan) * 100, 0.5)
          const colors = GANTT_STATUS_COLORS[entry.status] || DEFAULT_GANTT_COLOR
          const fillWidth = Math.min(entry.progress, 100)
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-2 ${entry.isKr ? 'pl-4' : ''}`}
              style={{ height: entry.isKr ? 22 : 28, marginBottom: 2 }}
            >
              {/* 标签 */}
              <div
                className={`shrink-0 truncate text-[11px] ${entry.isKr ? 'text-gray-400 w-28' : `font-medium ${colors.text} w-36`}`}
                title={entry.title}
              >
                {entry.isKr ? '  ' : ''}{entry.title}
              </div>
              {/* 条 */}
              <div className="relative flex-1" style={{ height: entry.isKr ? 14 : 18 }}>
                <div
                  className="absolute rounded"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: '100%',
                    background: colors.bar,
                  }}
                >
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${fillWidth}%`,
                      background: colors.fill,
                      opacity: 0.85,
                    }}
                  />
                </div>
              </div>
              {/* 百分比 */}
              <span className="shrink-0 text-[10px] text-gray-500 w-10 text-right">
                {entry.progress.toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>

      {/* 图例 */}
      <div className="flex gap-4 pt-2 border-t border-gray-800 mt-2">
        {[
          { label: '进行中', color: 'rgb(59,130,246)' },
          { label: '有风险', color: 'rgb(245,158,11)' },
          { label: '已完成', color: 'rgb(34,197,94)' },
          { label: '已归档', color: 'rgb(156,163,175)' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        {showToday && (
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="inline-block w-3 h-px bg-red-500" />
            今天
          </span>
        )}
      </div>
    </div>
  )
}

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
  const [showGantt, setShowGantt] = useState(false)

  const handleExportCsv = useCallback(() => {
    exportOkrToCsv(okrs)
  }, [okrs])

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
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-xs"
            >
              导出报表
            </button>
            <button
              onClick={() => setShowGantt((v) => !v)}
              className={`px-3 py-1.5 rounded text-xs ${showGantt ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-800 hover:bg-gray-700'}`}
            >
              {showGantt ? '关闭甘特图' : '甘特图'}
            </button>
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

        {/* 甘特图时间线 */}
        {showGantt && <GanttTimeline objectives={okrs} />}

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
