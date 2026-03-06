import { useState, useMemo } from 'react'
import { Loader2, RefreshCw, ChevronRight, X } from 'lucide-react'
import type { AgentProjectOption, AgentExportOptions } from '../../features/studio/types'
import { formatRelativeTime } from '../../features/studio/utils'

function AgentProjectExportDialog({
  projects,
  loading,
  exporting,
  options,
  onChangeOptions,
  onRefresh,
  onClose,
  onConfirm,
}: {
  projects: AgentProjectOption[]
  loading: boolean
  exporting: boolean
  options: AgentExportOptions
  onChangeOptions: (patch: Partial<AgentExportOptions>) => void
  onRefresh: () => void | Promise<void>
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [keyword, setKeyword] = useState('')
  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    if (!normalizedKeyword) return projects
    return projects.filter((project) => {
      const brief = (project.creative_brief || {}) as Record<string, unknown>
      const briefTitle = typeof brief.title === 'string' ? brief.title : ''
      return [project.name, project.id, briefTitle]
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword)
    })
  }, [keyword, projects])
  const selectedProject = projects.find((project) => project.id === options.selectedProjectId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[88vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">导出到 Agent</h3>
            <p className="text-xs text-gray-500 mt-0.5">可选择新建项目或覆盖已有项目</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" disabled={exporting}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onChangeOptions({ mode: 'new' })}
              className={`px-3 py-2 rounded border text-sm transition-colors ${
                options.mode === 'new'
                  ? 'border-purple-500/70 bg-purple-900/25 text-purple-100'
                  : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800'
              }`}
              disabled={exporting}
            >
              新建 Agent 项目
            </button>
            <button
              onClick={() => onChangeOptions({ mode: 'existing' })}
              className={`px-3 py-2 rounded border text-sm transition-colors ${
                options.mode === 'existing'
                  ? 'border-purple-500/70 bg-purple-900/25 text-purple-100'
                  : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800'
              }`}
              disabled={exporting}
            >
              覆盖已有项目
            </button>
          </div>

          {options.mode === 'new' ? (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-2">
              <label className="text-xs text-gray-500">项目名称（可选，不填则自动生成）</label>
              <input
                value={options.projectName}
                onChange={(e) => onChangeOptions({ projectName: e.target.value })}
                disabled={exporting}
                placeholder="例如：竹取物语 · 第1幕 精修"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 disabled:opacity-60"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-950/35">
              <div className="p-3 pb-2 flex items-center gap-2">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索 Agent 项目（名称 / ID / 标题）"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                  disabled={loading || exporting}
                />
                <button
                  onClick={() => onRefresh()}
                  disabled={loading || exporting}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {loading ? (
                <div className="h-52 flex items-center justify-center text-gray-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  正在加载 Agent 项目列表...
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-gray-500 text-sm">
                  {projects.length === 0 ? '暂无可覆盖的 Agent 项目' : '没有匹配的项目'}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto p-2 space-y-2">
                  {filteredProjects.map((project) => {
                    const brief = (project.creative_brief || {}) as Record<string, unknown>
                    const briefTitle = typeof brief.title === 'string' ? brief.title : ''
                    const updatedLabel = project.updated_at ? formatRelativeTime(project.updated_at) : '--'
                    return (
                      <button
                        key={project.id}
                        onClick={() => onChangeOptions({ selectedProjectId: project.id })}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          options.selectedProjectId === project.id
                            ? 'border-purple-500/70 bg-purple-900/25'
                            : 'border-gray-800 bg-gray-900/55 hover:border-gray-600'
                        }`}
                        disabled={exporting}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-gray-100 truncate">{project.name || project.id}</p>
                          <span className="text-[11px] text-gray-500 shrink-0">{updatedLabel}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">ID: {project.id}</p>
                        {briefTitle && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-1">{briefTitle}</p>
                        )}
                        <div className="mt-1.5 text-[11px] text-gray-500">
                          段落 {project.segments_count ?? '--'} · 元素 {project.elements_count ?? '--'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-2">
            <p className="text-xs text-gray-500">同步选项</p>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={options.includeSharedElements}
                onChange={(e) => onChangeOptions({ includeSharedElements: e.target.checked })}
                disabled={exporting}
              />
              包含系列共享元素
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={options.includeEpisodeElements}
                onChange={(e) => onChangeOptions({ includeEpisodeElements: e.target.checked })}
                disabled={exporting}
              />
              包含当前分幕元素
            </label>
            {options.mode === 'existing' && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={options.preserveExistingMessages}
                  onChange={(e) => onChangeOptions({ preserveExistingMessages: e.target.checked })}
                  disabled={exporting}
                />
                保留 Agent 历史消息与记忆
              </label>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 truncate pr-3">
            {options.mode === 'existing'
              ? (selectedProject ? `将覆盖：${selectedProject.name || selectedProject.id}` : '请选择要覆盖的 Agent 项目')
              : (options.projectName.trim() ? `新建项目：${options.projectName.trim()}` : '将自动生成 Agent 项目名称')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              disabled={exporting}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm()}
              disabled={loading || exporting || (options.mode === 'existing' && !options.selectedProjectId)}
              className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {options.mode === 'existing' ? '覆盖并导出' : '新建并导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentProjectExportDialog
