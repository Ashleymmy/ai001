/**
 * 情绪氛围包选择器
 * 用于镜头详情面板中快速选择情绪氛围
 */

import { useState, useEffect, useRef } from 'react'
import { Palette, ChevronDown } from 'lucide-react'
import { fetchKBMoodPacks } from '../../services/api'
import type { KBMoodPack } from '../../services/api'

interface MoodPackSelectorProps {
  value: string
  onChange: (moodKey: string) => void
  seriesId?: string
}

const MOOD_BADGE_COLORS: Record<string, string> = {
  tense: 'bg-red-500/20 text-red-300 border-red-500/40',
  hopeful: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  melancholic: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  romantic: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
  comedic: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  mysterious: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  epic: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  serene: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
}

const MOOD_DOT_COLORS: Record<string, string> = {
  tense: 'bg-red-400',
  hopeful: 'bg-amber-400',
  melancholic: 'bg-blue-400',
  romantic: 'bg-pink-400',
  comedic: 'bg-yellow-400',
  mysterious: 'bg-purple-400',
  epic: 'bg-orange-400',
  serene: 'bg-emerald-400',
}

const MOOD_LABELS: Record<string, string> = {
  tense: '紧张',
  hopeful: '希望',
  melancholic: '忧郁',
  romantic: '浪漫',
  comedic: '喜剧',
  mysterious: '神秘',
  epic: '史诗',
  serene: '宁静',
}

export default function MoodPackSelector({ value, onChange, seriesId }: MoodPackSelectorProps) {
  const [open, setOpen] = useState(false)
  const [packs, setPacks] = useState<KBMoodPack[]>([])
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchKBMoodPacks(seriesId).then(setPacks).catch(() => setPacks([]))
  }, [seriesId])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPreviewKey(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedPack = packs.find((p) => p.mood_key === value)
  const hoveredPack = packs.find((p) => p.mood_key === previewKey)
  const displayLabel = value ? (MOOD_LABELS[value] || value) : '选择氛围'
  const badgeClass = value ? (MOOD_BADGE_COLORS[value] || 'bg-gray-500/20 text-gray-300 border-gray-500/40') : 'bg-gray-800 text-gray-400 border-gray-700'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors ${badgeClass}`}
      >
        <Palette className="w-3 h-3" />
        {displayLabel}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
          {/* Mood grid */}
          <div className="p-2 grid grid-cols-4 gap-1.5">
            {packs.map((pack) => {
              const isSelected = pack.mood_key === value
              const dotColor = MOOD_DOT_COLORS[pack.mood_key] || 'bg-gray-400'
              const label = MOOD_LABELS[pack.mood_key] || pack.mood_key
              return (
                <button
                  key={pack.mood_key}
                  onClick={() => {
                    onChange(pack.mood_key)
                    setOpen(false)
                    setPreviewKey(null)
                  }}
                  onMouseEnter={() => setPreviewKey(pack.mood_key)}
                  onMouseLeave={() => setPreviewKey(null)}
                  className={`flex flex-col items-center gap-1 px-1.5 py-2 rounded-lg text-[11px] transition-colors ${
                    isSelected
                      ? 'bg-purple-600/20 border border-purple-500/50 text-purple-200'
                      : 'hover:bg-gray-800 border border-transparent text-gray-300'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${dotColor}`} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* Preview */}
          {(hoveredPack || selectedPack) && (
            <div className="border-t border-gray-700/50 px-3 py-2">
              <p className="text-[10px] text-gray-500 mb-1">
                {MOOD_LABELS[(hoveredPack || selectedPack)!.mood_key] || (hoveredPack || selectedPack)!.mood_key} - 合成提示词
              </p>
              <p className="text-[11px] text-gray-300 line-clamp-3">
                {(hoveredPack || selectedPack)!.combined_prompt || '(无)'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
