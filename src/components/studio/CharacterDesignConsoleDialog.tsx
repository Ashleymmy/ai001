import { useState, useMemo } from 'react'
import type { ChangeEvent } from 'react'
import {
  X, FileText, Sparkles, Loader2, Play,
} from 'lucide-react'
import type {
  StudioSeries,
  StudioElement,
} from '../../store/studioStore'
import { hasMultiAgeSignals } from './ElementEditDialog'

function CharacterDesignConsoleDialog({
  series,
  elements,
  busy,
  onImportDocument,
  onSplitCharacterByAge,
  onClose,
}: {
  series: StudioSeries
  elements: StudioElement[]
  busy: boolean
  onImportDocument: (
    documentText: string,
    options: { saveToElements: boolean; dedupeByName: boolean },
  ) => Promise<{ created: number; updated: number; skipped: number; items: Array<{ name: string; stage_label: string; description: string }> } | null>
  onSplitCharacterByAge: (
    elementId: string,
    options: { replaceOriginal: boolean },
  ) => Promise<{ need_split: boolean; created: number; updated: number; reason?: string } | null>
  onClose: () => void
}) {
  const [tab, setTab] = useState<'import' | 'split'>('import')
  const [docText, setDocText] = useState('')
  const [docFileName, setDocFileName] = useState('')
  const [saveToElements, setSaveToElements] = useState(true)
  const [dedupeByName, setDedupeByName] = useState(true)
  const [replaceOriginal, setReplaceOriginal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [batchSplitting, setBatchSplitting] = useState(false)
  const [splittingId, setSplittingId] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<{
    created: number
    updated: number
    skipped: number
    total: number
  } | null>(null)
  const [splitMessages, setSplitMessages] = useState<Record<string, string>>({})

  const characters = useMemo(
    () => elements.filter((el) => el.type === 'character'),
    [elements],
  )
  const suspiciousCharacters = useMemo(
    () => characters.filter((el) => hasMultiAgeSignals(el.description) || hasMultiAgeSignals(el.voice_profile)),
    [characters],
  )

  const handlePickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setDocText(text)
    setDocFileName(file.name)
  }

  const handleImport = async () => {
    if (!docText.trim()) return
    setImporting(true)
    try {
      const result = await onImportDocument(docText, { saveToElements, dedupeByName })
      if (!result) return
      setImportSummary({
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        total: result.items.length,
      })
      if (saveToElements) {
        setTab('split')
      }
    } finally {
      setImporting(false)
    }
  }

  const runSplit = async (elementId: string) => {
    setSplittingId(elementId)
    try {
      const result = await onSplitCharacterByAge(elementId, { replaceOriginal })
      if (!result) return
      setSplitMessages((prev) => ({
        ...prev,
        [elementId]: result.need_split
          ? `完成：新增 ${result.created}，更新 ${result.updated}`
          : (result.reason || '无需拆分'),
      }))
    } finally {
      setSplittingId(null)
    }
  }

  const runBatchSplit = async () => {
    if (suspiciousCharacters.length <= 0) return
    setBatchSplitting(true)
    try {
      for (const character of suspiciousCharacters) {
        // eslint-disable-next-line no-await-in-loop
        await runSplit(character.id)
      }
    } finally {
      setBatchSplitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">角色设计控制台</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {series.name} · 角色 {characters.length} · 多阶段疑似 {suspiciousCharacters.length}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 border-b border-gray-800 flex items-center gap-2">
          <button
            onClick={() => setTab('import')}
            className={`px-2 py-1 text-xs rounded ${tab === 'import' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            文档导入拆分
          </button>
          <button
            onClick={() => setTab('split')}
            className={`px-2 py-1 text-xs rounded ${tab === 'split' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            阶段拆分
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {tab === 'import' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-300 inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 cursor-pointer">
                    <FileText className="w-3.5 h-3.5" />
                    上传角色文档（txt/md）
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,text/plain,text/markdown"
                      className="hidden"
                      onChange={handlePickFile}
                    />
                  </label>
                  {docFileName && <span className="text-[11px] text-gray-500">{docFileName}</span>}
                </div>
                <textarea
                  rows={12}
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  placeholder="粘贴角色设定文档；可包含多人资料，系统会自动拆分为单角色单阶段版本。"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                />
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={saveToElements} onChange={(e) => setSaveToElements(e.target.checked)} />
                    写入素材库
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={dedupeByName} onChange={(e) => setDedupeByName(e.target.checked)} />
                    同名角色优先更新
                  </label>
                  <button
                    onClick={handleImport}
                    disabled={busy || importing || !docText.trim()}
                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40"
                  >
                    {(busy || importing) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    解析并导入
                  </button>
                </div>
              </div>

              {importSummary && (
                <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs text-gray-300">
                  处理结果：解析 {importSummary.total} 条，新增 {importSummary.created}，更新 {importSummary.updated}，跳过 {importSummary.skipped}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-gray-300">
                  已识别多阶段疑似角色：{suspiciousCharacters.length}
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                  <input type="checkbox" checked={replaceOriginal} onChange={(e) => setReplaceOriginal(e.target.checked)} />
                  拆分后删除原条目
                </label>
                <button
                  onClick={runBatchSplit}
                  disabled={busy || batchSplitting || suspiciousCharacters.length <= 0}
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40"
                >
                  {(batchSplitting || busy) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  批量拆分疑似多阶段角色
                </button>
              </div>

              <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
                {characters.map((el) => {
                  const suspicious = hasMultiAgeSignals(el.description) || hasMultiAgeSignals(el.voice_profile)
                  return (
                    <div key={el.id} className={`rounded-lg border p-3 ${suspicious ? 'border-amber-700/50 bg-amber-950/10' : 'border-gray-800 bg-gray-950/40'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-100 truncate">{el.name}</p>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{el.description || '暂无描述'}</p>
                          {splitMessages[el.id] && (
                            <p className="text-[11px] text-purple-300 mt-1">{splitMessages[el.id]}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {suspicious && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">
                              多阶段疑似
                            </span>
                          )}
                          <button
                            onClick={() => runSplit(el.id)}
                            disabled={busy || splittingId === el.id}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40"
                          >
                            {splittingId === el.id ? '拆分中...' : '按阶段拆分'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {characters.length <= 0 && (
                  <p className="text-xs text-gray-500 py-4 text-center">暂无角色素材</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CharacterDesignConsoleDialog
