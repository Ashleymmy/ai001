/**
 * ImportElementsModal: Dialog for importing elements from a previous/historical Agent project.
 */

import { Download, Loader2, Trash2, X } from 'lucide-react'
import type { AgentProject, AgentElement } from '../../../services/api'

export interface ImportElementsModalProps {
  agentProjects: AgentProject[]
  projectId: string | null
  elements: Record<string, AgentElement>
  importSourceProjectId: string | null
  importSourceProject: AgentProject | null
  importSelectedElementIds: Set<string>
  importElementQuery: string
  importElementTypeFilter: 'all' | 'character' | 'scene' | 'object'
  importElementShowOnlyMissing: boolean
  importElementShowOnlyConflicts: boolean
  importingElements: boolean
  onSetImportSourceProjectId: (id: string | null) => void
  onSetImportSelectedElementIds: (ids: Set<string>) => void
  onSetImportElementQuery: (q: string) => void
  onSetImportElementTypeFilter: (f: 'all' | 'character' | 'scene' | 'object') => void
  onSetImportElementShowOnlyMissing: (v: boolean) => void
  onSetImportElementShowOnlyConflicts: (v: boolean) => void
  onClose: () => void
  onImport: () => void
  onDeleteSelected: () => void
}

export default function ImportElementsModal({
  agentProjects,
  projectId,
  elements,
  importSourceProjectId,
  importSourceProject,
  importSelectedElementIds,
  importElementQuery,
  importElementTypeFilter,
  importElementShowOnlyMissing,
  importElementShowOnlyConflicts,
  importingElements,
  onSetImportSourceProjectId,
  onSetImportSelectedElementIds,
  onSetImportElementQuery,
  onSetImportElementTypeFilter,
  onSetImportElementShowOnlyMissing,
  onSetImportElementShowOnlyConflicts,
  onClose,
  onImport,
  onDeleteSelected,
}: ImportElementsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[92vw] max-w-3xl max-h-[80vh] glass-card rounded-2xl border border-white/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">导入上一集/历史项目元素</p>
            <p className="text-xs text-gray-500 mt-1">把人物/场景/道具直接导入本集，减少续集缺失与重复配置</p>
          </div>
          <button className="p-2 glass rounded-lg hover:bg-white/10" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 132px)' }}>
          <div className="space-y-2">
            <p className="text-xs text-gray-400">选择来源项目</p>
            <select
              className="w-full glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
              value={importSourceProjectId || ''}
              onChange={(e) => onSetImportSourceProjectId(e.target.value || null)}
            >
              <option value="" disabled>请选择一个历史项目…</option>
              {agentProjects
                .filter((p) => p.id !== projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
            </select>
          </div>

          {importSourceProject && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">选择要导入的元素</p>
                <div className="flex gap-2">
                  <button
                    className="text-xs glass-button px-2 py-1 rounded-lg"
                    onClick={() => {
                      const els = Object.values(importSourceProject.elements || {})
                      const query = importElementQuery.trim().toLowerCase()
                      const filtered = els.filter((el) => {
                        if (importElementTypeFilter !== 'all' && el.type !== importElementTypeFilter) return false
                        const hasConflict = Boolean(elements[el.id])
                        if (importElementShowOnlyMissing && hasConflict) return false
                        if (importElementShowOnlyConflicts && !hasConflict) return false
                        if (query) {
                          const hay = `${el.id} ${el.name} ${el.type}`.toLowerCase()
                          if (!hay.includes(query)) return false
                        }
                        return true
                      })
                      onSetImportSelectedElementIds(new Set(filtered.map((el) => el.id)))
                    }}
                  >
                    全选（筛选结果）
                  </button>
                  <button
                    className="text-xs glass-button px-2 py-1 rounded-lg"
                    onClick={() => {
                      onSetImportElementTypeFilter('character')
                      onSetImportElementShowOnlyMissing(false)
                      onSetImportElementShowOnlyConflicts(false)
                      const els = Object.values(importSourceProject.elements || {}).filter((el) => el.type === 'character')
                      onSetImportSelectedElementIds(new Set(els.map((el) => el.id)))
                    }}
                    title="只导入人物（character）"
                  >
                    只导入人物
                  </button>
                  <button
                    className="text-xs glass-button px-2 py-1 rounded-lg"
                    onClick={() => onSetImportSelectedElementIds(new Set())}
                  >
                    全不选
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={importElementQuery}
                  onChange={(e) => onSetImportElementQuery(e.target.value)}
                  placeholder="搜索：元素名 / ID / type…"
                  className="sm:col-span-2 glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                />
                <select
                  className="glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                  value={importElementTypeFilter}
                  onChange={(e) => onSetImportElementTypeFilter(e.target.value as typeof importElementTypeFilter)}
                >
                  <option value="all">全部类型</option>
                  <option value="character">人物 character</option>
                  <option value="scene">场景 scene</option>
                  <option value="object">道具 object</option>
                </select>
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importElementShowOnlyMissing}
                    onChange={(e) => {
                      onSetImportElementShowOnlyMissing(e.target.checked)
                      if (e.target.checked) onSetImportElementShowOnlyConflicts(false)
                    }}
                  />
                  仅看未存在
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importElementShowOnlyConflicts}
                    onChange={(e) => {
                      onSetImportElementShowOnlyConflicts(e.target.checked)
                      if (e.target.checked) onSetImportElementShowOnlyMissing(false)
                    }}
                  />
                  仅看冲突（同 ID）
                </label>
              </div>

              <div className="glass-dark rounded-xl border border-white/10 overflow-hidden">
                <div className="max-h-[42vh] overflow-y-auto divide-y divide-white/5">
                  {Object.values(importSourceProject.elements || {})
                    .filter((el) => {
                      if (importElementTypeFilter !== 'all' && el.type !== importElementTypeFilter) return false
                      const hasConflict = Boolean(elements[el.id])
                      if (importElementShowOnlyMissing && hasConflict) return false
                      if (importElementShowOnlyConflicts && !hasConflict) return false
                      const query = importElementQuery.trim().toLowerCase()
                      if (query) {
                        const hay = `${el.id} ${el.name} ${el.type}`.toLowerCase()
                        if (!hay.includes(query)) return false
                      }
                      return true
                    })
                    .map((el) => {
                    const checked = importSelectedElementIds.has(el.id)
                    const hasConflict = Boolean(elements[el.id])
                    return (
                      <label key={el.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(importSelectedElementIds)
                            if (next.has(el.id)) next.delete(el.id)
                            else next.add(el.id)
                            onSetImportSelectedElementIds(next)
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm truncate">{el.name}</span>
                            <span className="text-[10px] text-gray-500 glass px-1.5 py-0.5 rounded">{el.type}</span>
                            {hasConflict && (
                              <span className="text-[10px] text-yellow-300 glass px-1.5 py-0.5 rounded" title="当前项目已有同 ID 元素，将执行合并（不覆盖已有内容）">
                                冲突→合并
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 truncate mt-0.5">{el.id}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              <p className="text-[10px] text-gray-500">
                合并策略：同 ID 元素默认不覆盖，仅补充缺失的参考图/历史/当前图（用于保证连续创作最稳妥）。
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
            onClick={onDeleteSelected}
            disabled={importingElements || Array.from(importSelectedElementIds).filter((id) => elements[id]).length === 0}
            title="从当前项目删除选中的元素（不影响来源项目）"
          >
            <Trash2 size={14} />
            删除选中（当前项目）
          </button>
          <button className="px-3 py-2 glass-button rounded-xl text-sm" onClick={onClose} disabled={importingElements}>
            取消
          </button>
          <button
            className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
            onClick={onImport}
            disabled={!importSourceProjectId || !importSourceProject || importSelectedElementIds.size === 0 || importingElements}
          >
            {importingElements ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            导入选中（{importSelectedElementIds.size}）
          </button>
        </div>
      </div>
    </div>
  )
}
