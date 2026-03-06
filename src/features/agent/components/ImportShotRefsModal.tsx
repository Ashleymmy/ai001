/**
 * ImportShotRefsModal: Dialog for importing shot reference images from a previous Agent project.
 */

import { CheckCircle, Download, Loader2, X } from 'lucide-react'
import type { AgentProject } from '../../../services/api'
import { resolveMediaUrl } from '../mediaUtils'

export interface ImportShotRefsModalProps {
  agentProjects: AgentProject[]
  projectId: string | null
  importShotRefsSourceProjectId: string | null
  importShotRefsSourceProject: AgentProject | null
  importShotRefsSelectedUrls: Set<string>
  importingShotRefs: boolean
  onSetImportShotRefsSourceProjectId: (id: string | null) => void
  onSetImportShotRefsSelectedUrls: (urls: Set<string>) => void
  onClose: () => void
  onImport: () => void
}

export default function ImportShotRefsModal({
  agentProjects,
  projectId,
  importShotRefsSourceProjectId,
  importShotRefsSourceProject,
  importShotRefsSelectedUrls,
  importingShotRefs,
  onSetImportShotRefsSourceProjectId,
  onSetImportShotRefsSelectedUrls,
  onClose,
  onImport,
}: ImportShotRefsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[92vw] max-w-4xl max-h-[80vh] glass-card rounded-2xl border border-white/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">导入镜头参考图</p>
            <p className="text-xs text-gray-500 mt-1">把上一集的镜头参考图/起始帧导入到当前镜头（用于续集场景连续）</p>
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
              value={importShotRefsSourceProjectId || ''}
              onChange={(e) => onSetImportShotRefsSourceProjectId(e.target.value || null)}
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

          {importShotRefsSourceProject && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">选择要导入的图片（点击选中/取消）</p>
              <div className="glass-dark rounded-xl border border-white/10 overflow-hidden">
                <div className="max-h-[48vh] overflow-y-auto divide-y divide-white/5">
                  {(importShotRefsSourceProject.segments || []).flatMap((seg) => seg.shots || []).map((shot) => {
                    const raw = [
                      ...(Array.isArray(shot.reference_images) ? shot.reference_images : []),
                      shot.cached_start_image_url,
                      shot.start_image_url,
                      ...(Array.isArray(shot.start_image_history) ? shot.start_image_history.map((h) => h.url) : [])
                    ].filter(Boolean) as string[]
                    const urls = Array.from(new Set(raw))
                    if (urls.length === 0) return null
                    return (
                      <div key={shot.id} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm truncate">{shot.name}</p>
                            <p className="text-[10px] text-gray-500 truncate">{shot.id}</p>
                          </div>
                          <button
                            className="text-xs glass-button px-2 py-1 rounded-lg"
                            onClick={() => {
                              const next = new Set(importShotRefsSelectedUrls)
                              for (const u of urls) next.add(u)
                              onSetImportShotRefsSelectedUrls(next)
                            }}
                          >
                            全选本镜头
                          </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {urls.map((u) => {
                            const selected = importShotRefsSelectedUrls.has(u)
                            return (
                              <button
                                key={u}
                                type="button"
                                onClick={() => {
                                  const next = new Set(importShotRefsSelectedUrls)
                                  if (next.has(u)) next.delete(u)
                                  else next.add(u)
                                  onSetImportShotRefsSelectedUrls(next)
                                }}
                                className={`relative flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border ${selected ? 'border-primary ring-2 ring-primary/50' : 'border-white/10 hover:border-white/30'} transition-apple`}
                                title={selected ? '已选中' : '点击选中'}
                              >
                                {(() => {
                                  const resolved = resolveMediaUrl(u)
                                  return resolved ? (
                                    <img src={resolved} alt="ref" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full bg-black/30 flex items-center justify-center text-[10px] text-gray-400">
                                      过期
                                    </div>
                                  )
                                })()}
                                {selected && (
                                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary/80 flex items-center justify-center">
                                    <CheckCircle size={12} className="text-white" />
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <p className="text-[10px] text-gray-500">提示：建议优先选用 `/api/uploads/...` 的图片作为参考图，稳定不易过期。</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button className="px-3 py-2 glass-button rounded-xl text-sm" onClick={onClose} disabled={importingShotRefs}>
            取消
          </button>
          <button
            className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
            onClick={onImport}
            disabled={!importShotRefsSourceProjectId || !importShotRefsSourceProject || importShotRefsSelectedUrls.size === 0 || importingShotRefs}
          >
            {importingShotRefs ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            导入到当前镜头（{importShotRefsSelectedUrls.size}）
          </button>
        </div>
      </div>
    </div>
  )
}
