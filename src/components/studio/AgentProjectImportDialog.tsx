import { useState, useMemo } from 'react'
import { Loader2, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { AgentProjectOption } from '../../features/studio/types'
import { formatRelativeTime } from '../../features/studio/utils'

function AgentProjectImportDialog({
  projects,
  loading,
  importing,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onClose,
  onConfirm,
}: {
  projects: AgentProjectOption[]
  loading: boolean
  importing: boolean
  selectedProjectId: string
  onSelectProject: (projectId: string) => void
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
  const selectedProject = projects.find((project) => project.id === selectedProjectId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[85vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">从 Agent 导入项目</h3>
            <p className="text-xs text-gray-500 mt-0.5">选择一个 Agent 项目并导入到当前分幕</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              导入将覆盖当前分幕的镜头内容，并同步 Agent 项目的元素信息。
            </p>
            <button
              onClick={() => onRefresh()}
              disabled={loading || importing}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              刷新列表
            </button>
          </div>

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索 Agent 项目（名称 / ID / 标题）"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            disabled={loading || importing}
          />

          <div className="rounded-lg border border-gray-800 bg-gray-950/35">
            {loading ? (
              <div className="h-56 flex items-center justify-center text-gray-400 text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                正在加载 Agent 项目列表...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-gray-500 text-sm">
                {projects.length === 0 ? '暂无可导入的 Agent 项目' : '没有匹配的项目'}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto p-2 space-y-2">
                {filteredProjects.map((project) => {
                  const brief = (project.creative_brief || {}) as Record<string, unknown>
                  const briefTitle = typeof brief.title === 'string' ? brief.title : ''
                  const updatedLabel = project.updated_at ? formatRelativeTime(project.updated_at) : '--'
                  return (
                    <button
                      key={project.id}
                      onClick={() => onSelectProject(project.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        selectedProjectId === project.id
                          ? 'border-purple-500/70 bg-purple-900/25'
                          : 'border-gray-800 bg-gray-900/55 hover:border-gray-600'
                      }`}
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
                        镜头段落 {project.segments_count ?? '--'} · 元素 {project.elements_count ?? '--'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 truncate pr-3">
            {selectedProject ? `已选：${selectedProject.name || selectedProject.id}` : '请选择要导入的 Agent 项目'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              disabled={importing}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm()}
              disabled={!selectedProjectId || loading || importing}
              className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              导入所选项目
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentProjectImportDialog
