import { useState, useEffect, useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import type { StudioSeries, StudioElement } from '../../store/studioStore'
import type { DigitalHumanProfileDraft } from '../../features/studio/types'
import {
  normalizeDigitalHumanProfiles,
  getDigitalHumanProfileDisplayName,
  createDigitalHumanProfile,
} from '../../features/studio/utils'

const DIGITAL_HUMAN_LIP_SYNC_OPTIONS = [
  '写实口型',
  '轻拟合口型',
  '夸张口型',
  '对白优先',
  '旁白优先',
] as const

function DigitalHumanProfileConsoleDialog({
  series,
  elements,
  busy,
  onClose,
  onSaveProfiles,
  onSyncProfilesToElements,
}: {
  series: StudioSeries
  elements: StudioElement[]
  busy: boolean
  onClose: () => void
  onSaveProfiles: (profiles: DigitalHumanProfileDraft[]) => Promise<void>
  onSyncProfilesToElements: (profiles: DigitalHumanProfileDraft[]) => Promise<void>
}) {
  const [profiles, setProfiles] = useState<DigitalHumanProfileDraft[]>(
    () => normalizeDigitalHumanProfiles(series.digital_human_profiles),
  )
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id || null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    const normalized = normalizeDigitalHumanProfiles(series.digital_human_profiles)
    setProfiles(normalized)
    setSelectedId(normalized[0]?.id || null)
  }, [series.id, series.digital_human_profiles])

  const selectedProfile = profiles.find((profile) => profile.id === selectedId) || null
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filteredProfiles = profiles.filter((profile) => {
    if (!normalizedKeyword) return true
    return [
      profile.base_name,
      profile.display_name,
      profile.stage_label,
      profile.appearance,
      profile.scene_template,
    ].join(' ').toLowerCase().includes(normalizedKeyword)
  })

  const linkedCharacterNames = useMemo(() => {
    const names = new Set<string>()
    elements
      .filter((item) => item.type === 'character')
      .forEach((item) => {
        const key = item.name.trim()
        if (key) names.add(key)
      })
    return names
  }, [elements])

  const upsertProfile = (profileId: string, patch: Partial<DigitalHumanProfileDraft>) => {
    setProfiles((prev) => prev.map((profile) => (
      profile.id === profileId ? { ...profile, ...patch } : profile
    )))
  }

  const addProfile = () => {
    const profile = createDigitalHumanProfile()
    setProfiles((prev) => [profile, ...prev])
    setSelectedId(profile.id)
  }

  const removeProfile = (profileId: string) => {
    setProfiles((prev) => {
      const next = prev.filter((profile) => profile.id !== profileId)
      if (!next.some((profile) => profile.id === selectedId)) {
        setSelectedId(next[0]?.id || null)
      }
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveProfiles(profiles)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndSync = async () => {
    setSyncing(true)
    try {
      await onSaveProfiles(profiles)
      await onSyncProfilesToElements(profiles)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[82]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">数字人角色控制台</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {series.name} · 阶段角色 {profiles.length} 条
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={busy || saving || syncing}
              className="text-xs px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
            <button
              onClick={handleSaveAndSync}
              disabled={busy || saving || syncing}
              className="text-xs px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
            >
              {(saving || syncing) ? '处理中...' : '保存并同步素材库'}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[300px_minmax(0,1fr)] max-h-[calc(90vh-64px)]">
          <aside className="border-r border-gray-800 p-3 space-y-2 overflow-y-auto">
            <div className="flex items-center gap-2">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索角色/阶段..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={addProfile}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white text-xs"
              >
                <Plus className="w-3 h-3" />
                新增
              </button>
            </div>
            <div className="space-y-1">
              {filteredProfiles.map((profile) => {
                const name = getDigitalHumanProfileDisplayName(profile)
                const linked = linkedCharacterNames.has(name)
                return (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedId(profile.id)}
                    className={`w-full text-left rounded border px-2.5 py-2 transition-colors ${
                      selectedId === profile.id
                        ? 'border-indigo-500/70 bg-indigo-900/25'
                        : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-100 truncate">{name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${linked ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                        {linked ? '已同步' : '未同步'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1 line-clamp-1">
                      {profile.appearance || '暂无形象描述'}
                    </p>
                  </button>
                )
              })}
              {filteredProfiles.length === 0 && (
                <p className="text-xs text-gray-500 py-6 text-center">暂无角色配置</p>
              )}
            </div>
          </aside>

          <div className="p-4 overflow-y-auto">
            {!selectedProfile && (
              <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-gray-500">
                请选择一个数字人角色配置，或新建角色
              </div>
            )}
            {selectedProfile && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium text-gray-100">角色阶段配置</h4>
                  <button
                    onClick={() => removeProfile(selectedProfile.id)}
                    className="text-xs px-2 py-1 rounded bg-red-900/35 hover:bg-red-900/50 text-red-200"
                  >
                    删除
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">角色主名</label>
                    <input
                      value={selectedProfile.base_name}
                      onChange={(e) => upsertProfile(selectedProfile.id, { base_name: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="例如：金蚊子"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">展示名（可选）</label>
                    <input
                      value={selectedProfile.display_name}
                      onChange={(e) => upsertProfile(selectedProfile.id, { display_name: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="例如：金蚊子（青年期）"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">阶段标签</label>
                    <input
                      value={selectedProfile.stage_label}
                      onChange={(e) => upsertProfile(selectedProfile.id, { stage_label: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="前期 / 后期 / 战后..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">口型策略</label>
                    <select
                      value={selectedProfile.lip_sync_style}
                      onChange={(e) => upsertProfile(selectedProfile.id, { lip_sync_style: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                    >
                      {DIGITAL_HUMAN_LIP_SYNC_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">形象描述</label>
                  <textarea
                    rows={4}
                    value={selectedProfile.appearance}
                    onChange={(e) => upsertProfile(selectedProfile.id, { appearance: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                    placeholder="描述该阶段的服饰、年龄感、神态、镜头友好特征"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">音色配置</label>
                  <input
                    value={selectedProfile.voice_profile}
                    onChange={(e) => upsertProfile(selectedProfile.id, { voice_profile: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                    placeholder="用于 TTS 的角色音色描述"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">场景模板</label>
                  <textarea
                    rows={3}
                    value={selectedProfile.scene_template}
                    onChange={(e) => upsertProfile(selectedProfile.id, { scene_template: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                    placeholder="常用背景、布光、机位和空间语义"
                  />
                </div>

                <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-[11px] text-gray-400">
                  同步到素材库后，会自动创建或更新同名 `character` 元素，供起始帧和视频提示词引用。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DigitalHumanProfileConsoleDialog
