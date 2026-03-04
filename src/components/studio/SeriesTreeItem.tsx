import { Film } from 'lucide-react'
import type { StudioSeries, StudioEpisode } from '../../store/studioStore'
import { getEpisodeStatusText, getEpisodeStatusBadgeClass } from '../../features/studio/utils'
import { StatusDot } from '../../pages/StudioPage'
import HoverOverviewPanel from './HoverOverviewPanel'

function SeriesTreeItem({
  series,
  isSelected,
  selectedEpisodeId,
  episodes,
  onSelectSeries,
  onSelectEpisode,
}: {
  series: StudioSeries
  isSelected: boolean
  selectedEpisodeId: string | null
  episodes: StudioEpisode[]
  onSelectSeries: (id: string) => void
  onSelectEpisode: (id: string) => void
}) {
  return (
    <div className="mb-1">
      <div className="group relative">
        <button
          onClick={() => onSelectSeries(series.id)}
          className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
            isSelected ? 'bg-purple-900/40 text-purple-200' : 'hover:bg-gray-800 text-gray-300'
          }`}
        >
          <Film className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{series.name}</span>
          {series.episode_count !== undefined && (
            <span className="ml-auto text-xs text-gray-500">{series.episode_count}集</span>
          )}
        </button>
        <HoverOverviewPanel maxWidthClass="max-w-xl">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-100 font-semibold line-clamp-1">{series.name}</p>
                <p className="text-xs text-gray-500">系列概览</p>
              </div>
              <div className="text-xs text-gray-400">{series.episode_count || episodes.length} 集</div>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed line-clamp-5">
              {series.description || '暂无系列描述'}
            </p>
            <div className="text-xs text-gray-500 flex items-center justify-between">
              <span>视觉风格: {series.visual_style || '未设置'}</span>
              <span>{series.element_count || 0} 个共享元素</span>
            </div>
          </div>
        </HoverOverviewPanel>
      </div>

      {isSelected && episodes.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {episodes.map((ep) => (
            <div key={ep.id} className="group relative">
              <button
                onClick={() => onSelectEpisode(ep.id)}
                className={`w-full text-left px-3 py-1 rounded text-xs flex items-center gap-2 transition-colors ${
                  ep.id === selectedEpisodeId
                    ? 'bg-purple-900/30 text-purple-200'
                    : 'hover:bg-gray-800 text-gray-400'
                }`}
              >
                <StatusDot status={ep.status} />
                <span className="truncate">第{ep.act_number}幕 {ep.title}</span>
              </button>
              <HoverOverviewPanel maxWidthClass="max-w-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-gray-100 font-semibold line-clamp-2">
                        第{ep.act_number}幕 {ep.title || '未命名分幕'}
                      </p>
                      <p className="text-xs text-gray-500">{series.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${getEpisodeStatusBadgeClass(ep.status)}`}>
                      {getEpisodeStatusText(ep.status)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-200 leading-relaxed line-clamp-5">
                    {ep.summary || '暂无摘要'}
                  </p>
                  <div className="text-xs text-gray-500 flex items-center justify-between">
                    <span>目标时长 {ep.target_duration_seconds || 0}s</span>
                    <span className="line-clamp-1 max-w-[60%]">{ep.script_excerpt || '无脚本片段'}</span>
                  </div>
                </div>
              </HoverOverviewPanel>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SeriesTreeItem
