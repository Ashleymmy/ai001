import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import type { ModelConfig } from '../store/settingsStore'
import { listCustomProviders, listGlobalCustomProviders, type CustomProvider } from '../services/api'

type Category = 'image' | 'storyboard' | 'video'

type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  models: string[]
}

interface ModuleModelSwitcherProps {
  category: Category
  title: string
  config: ModelConfig
  providers: ProviderPreset[]
  onApply: (updates: Partial<ModelConfig>) => Promise<void> | void
}

export default function ModuleModelSwitcher({
  category,
  title,
  config,
  providers,
  onApply
}: ModuleModelSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [moduleCustomProviders, setModuleCustomProviders] = useState<CustomProvider[]>([])
  const [globalCustomProviders, setGlobalCustomProviders] = useState<CustomProvider[]>([])
  const [draft, setDraft] = useState<ModelConfig>(config)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setDraft(config)
      Promise.allSettled([listCustomProviders(), listGlobalCustomProviders()])
        .then((results) => {
          const moduleList = results[0].status === 'fulfilled' ? results[0].value : []
          const globalList = results[1].status === 'fulfilled' ? results[1].value : []
          setModuleCustomProviders(Array.isArray(moduleList) ? moduleList : [])
          setGlobalCustomProviders(Array.isArray(globalList) ? globalList : [])
        })
    }
  }, [open, config])

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!open) return
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const mergedCustomProviders = useMemo(() => {
    const merged = new Map<string, CustomProvider>()
    for (const p of globalCustomProviders) merged.set(p.id, p)
    for (const p of moduleCustomProviders) merged.set(p.id, p)
    return [...merged.values()]
  }, [moduleCustomProviders, globalCustomProviders])

  const allowedCustomProviders = useMemo(() => {
    const acceptedCategories = category === 'storyboard'
      ? new Set(['storyboard', 'image'])
      : new Set([category])
    const filtered = mergedCustomProviders.filter((p) => acceptedCategories.has(p.category))
    // 兼容历史数据：当前已选 custom provider 即使分类不匹配也保留可选，避免“看得到但切不了”
    const current = mergedCustomProviders.find((p) => p.id === config.provider)
    if (current && !filtered.some((p) => p.id === current.id)) {
      filtered.unshift(current)
    }
    const knownProviderIds = new Set([
      ...providers.map((p) => p.id),
      ...filtered.map((p) => p.id)
    ])
    if (config.provider && !knownProviderIds.has(config.provider)) {
      filtered.unshift({
        id: config.provider,
        name: `当前配置 (${config.provider})`,
        category,
        isCustom: true,
        apiKey: config.apiKey || '',
        baseUrl: config.baseUrl || '',
        model: config.model || '',
        models: [],
        created_at: '',
        updated_at: ''
      })
    }
    return filtered
  }, [mergedCustomProviders, category, config.provider, config.apiKey, config.baseUrl, config.model, providers])

  const selectedPreset = useMemo(
    () => providers.find((p) => p.id === draft.provider),
    [providers, draft.provider]
  )
  const selectedCustom = useMemo(
    () => allowedCustomProviders.find((p) => p.id === draft.provider),
    [allowedCustomProviders, draft.provider]
  )

  const modelOptions = useMemo(() => {
    if (selectedCustom?.models?.length) return selectedCustom.models
    if (selectedPreset?.models?.length) return selectedPreset.models
    return []
  }, [selectedCustom, selectedPreset])

  const displayProviderName = useMemo(() => {
    const fromCustom = allowedCustomProviders.find((p) => p.id === config.provider)
    if (fromCustom) return fromCustom.name
    const fromPreset = providers.find((p) => p.id === config.provider)
    return fromPreset?.name || config.provider
  }, [config.provider, allowedCustomProviders, providers])

  const handleProviderChange = (providerId: string) => {
    const preset = providers.find((p) => p.id === providerId)
    if (preset) {
      setDraft((prev) => ({
        ...prev,
        provider: preset.id,
        baseUrl: preset.baseUrl || '',
        model: preset.models[0] || '',
        customProvider: undefined
      }))
      return
    }
    const custom = allowedCustomProviders.find((p) => p.id === providerId)
    if (custom) {
      setDraft((prev) => ({
        ...prev,
        provider: custom.id,
        apiKey: custom.apiKey || prev.apiKey,
        baseUrl: custom.baseUrl || prev.baseUrl,
        model: custom.model || prev.model,
        customProvider: custom.name
      }))
    }
  }

  const handleApply = async () => {
    setSaving(true)
    try {
      await onApply({
        provider: draft.provider,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl,
        model: draft.model,
        customProvider: draft.customProvider
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 glass-button rounded-lg text-xs hover:bg-white/10"
        title={`${title}切换`}
      >
        <Cpu size={14} />
        <span className="hidden xl:inline max-w-[200px] truncate">
          {displayProviderName} / {config.model || '默认模型'}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 glass-card rounded-xl p-3 z-30 animate-fadeIn">
          <div className="text-sm font-medium mb-3">{title}</div>

          <div className="space-y-3">
            <div>
              <div className="text-xs text-gray-400 mb-1.5">服务商</div>
              <select
                value={draft.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full glass-input p-2.5 text-sm bg-gray-900/80"
              >
                {providers.filter((p) => p.id !== 'custom').map((p) => (
                  <option key={p.id} value={p.id} className="bg-gray-900 text-white">
                    {p.name}
                  </option>
                ))}
                {allowedCustomProviders.length > 0 && (
                  <optgroup label="自定义配置">
                    {allowedCustomProviders.map((p) => (
                      <option key={p.id} value={p.id} className="bg-gray-900 text-white">
                        {p.name} {p.category !== category ? `(${p.category})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {modelOptions.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1.5">模型列表</div>
                <select
                  value={draft.model}
                  onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
                  className="w-full glass-input p-2.5 text-sm bg-gray-900/80"
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m} className="bg-gray-900 text-white">
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="text-xs text-gray-400 mb-1.5">
                {draft.provider === 'doubao' ? '推理接入点 ID' : '模型'}
              </div>
              <input
                value={draft.model}
                onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
                placeholder={draft.provider === 'doubao' ? 'ep-xxx' : '输入模型名称'}
                className="w-full glass-input p-2.5 text-sm"
              />
              {draft.provider === 'doubao' && (
                <div className="text-[11px] text-amber-300/90 mt-1">
                  豆包请填写 /models 返回的 endpoint id（通常是 ep-xxx）
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs glass-button"
            >
              取消
            </button>
            <button
              onClick={handleApply}
              disabled={saving || !draft.provider}
              className="px-3 py-1.5 rounded-lg text-xs bg-gradient-to-r from-blue-500 to-cyan-500 text-white disabled:opacity-50"
            >
              {saving ? '保存中...' : '应用'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
