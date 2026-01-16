import { FileText, Layers } from 'lucide-react'


// JSON 数据卡片组件 - 美化 JSON 输出
export function JsonDataCard({ data }: { data: Record<string, unknown> }) {
  // 检测数据类型并渲染对应的卡片
  if (data.creative_brief) {
    return <CreativeBriefCard data={data} />
  }
  if (data.project_name || data.style_guide) {
    return <ProjectPlanCard data={data} />
  }
  if (data.next_options) {
    return <NextOptionsCard data={data} />
  }
  
  // 检测是否是项目规划数据（包含 elements 和 segments）
  if (data.elements || data.segments) {
    return <PlanSummaryCard data={data} />
  }
  
  // 通用美化卡片 - 不显示原始 JSON
  return <GenericDataCard data={data} />
}

// 通用数据卡片 - 美化显示任意结构
export function GenericDataCard({ data }: { data: Record<string, unknown> }) {
  const renderValue = (value: unknown, depth = 0): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="text-gray-500">-</span>
    }
    
    if (typeof value === 'string') {
      return <span>{value}</span>
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return <span className="text-blue-400">{String(value)}</span>
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-gray-500">空列表</span>
      
      // 简单数组（字符串/数字）
      if (value.every(v => typeof v === 'string' || typeof v === 'number')) {
        return <span>{value.join('、')}</span>
      }
      
      // 复杂数组
      return (
        <div className="space-y-2 mt-1">
          {value.slice(0, 5).map((item, idx) => (
            <div key={idx} className="glass p-2 rounded-lg text-xs">
              {typeof item === 'object' && item !== null ? (
                Object.entries(item as Record<string, unknown>).slice(0, 3).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-gray-500">{formatKey(k)}:</span>{' '}
                    <span>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                  </div>
                ))
              ) : (
                String(item)
              )}
            </div>
          ))}
          {value.length > 5 && (
            <p className="text-xs text-gray-500">...还有 {value.length - 5} 项</p>
          )}
        </div>
      )
    }
    
    if (typeof value === 'object' && depth < 2) {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) return <span className="text-gray-500">-</span>
      
      return (
        <div className="glass p-2 rounded-lg mt-1 space-y-1">
          {entries.slice(0, 5).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="text-gray-500">{formatKey(k)}:</span>{' '}
              {renderValue(v, depth + 1)}
            </div>
          ))}
          {entries.length > 5 && (
            <p className="text-xs text-gray-500">...还有 {entries.length - 5} 项</p>
          )}
        </div>
      )
    }
    
    // 深层对象，简化显示
    return <span className="text-gray-400">[对象]</span>
  }
  
  // 过滤掉一些不需要显示的字段
  const filteredEntries = Object.entries(data).filter(([key]) => 
    !['type', 'success', 'raw'].includes(key)
  )
  
  if (filteredEntries.length === 0) {
    return null
  }
  
  return (
    <div className="glass p-4 rounded-xl space-y-3">
      {filteredEntries.map(([key, value]) => (
        <div key={key}>
          <p className="text-xs text-gray-500 mb-1">{formatKey(key)}</p>
          <div className="text-sm">{renderValue(value)}</div>
        </div>
      ))}
    </div>
  )
}

// 项目规划摘要卡片
export function PlanSummaryCard({ data }: { data: Record<string, unknown> }) {
  const elements = data.elements as Array<{ id: string; name: string; type: string }> | Record<string, { name: string; type: string }> | undefined
  const segments = data.segments as Array<{ id: string; name: string; shots?: Array<unknown> }> | undefined
  const costEstimate = data.cost_estimate as Record<string, string> | undefined
  
  // 处理 elements 可能是数组或对象的情况
  const elementList = Array.isArray(elements) 
    ? elements 
    : elements 
      ? Object.values(elements) 
      : []
  
  const totalShots = segments?.reduce((acc, s) => acc + (s.shots?.length || 0), 0) || 0
  
  return (
    <div className="glass p-4 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-purple-400" />
        <span className="font-semibold text-white">项目规划摘要</span>
      </div>
      
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-blue-400">{elementList.length}</p>
          <p className="text-xs text-gray-500">角色/元素</p>
        </div>
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-purple-400">{segments?.length || 0}</p>
          <p className="text-xs text-gray-500">段落</p>
        </div>
        <div className="glass p-3 rounded-lg">
          <p className="text-2xl font-bold text-pink-400">{totalShots}</p>
          <p className="text-xs text-gray-500">镜头</p>
        </div>
      </div>
      
      {elementList.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">关键角色</p>
          <div className="flex flex-wrap gap-2">
            {elementList.slice(0, 6).map((e, idx) => (
              <span key={idx} className="px-2 py-1 glass rounded-lg text-xs">
                {e.name} <span className="text-gray-500">({e.type})</span>
              </span>
            ))}
            {elementList.length > 6 && (
              <span className="px-2 py-1 text-xs text-gray-500">+{elementList.length - 6}</span>
            )}
          </div>
        </div>
      )}
      
      {costEstimate && (
        <div className="glass p-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-2">预估成本</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(costEstimate).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-gray-400">{formatKey(k)}</span>
                <span className={k === 'total' ? 'text-yellow-400 font-medium' : ''}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Creative Brief 卡片
export function CreativeBriefCard({ data }: { data: Record<string, unknown> }) {
  const brief = data.creative_brief as Record<string, string | Record<string, unknown>>
  
  return (
    <div className="glass p-4 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-blue-400" />
        <span className="font-semibold text-white">Creative Brief</span>
      </div>
      
      <div className="grid grid-cols-2 gap-3 text-xs">
        {brief.project_name && (
          <div className="col-span-2">
            <p className="text-gray-500">项目名称</p>
            <p className="text-white font-medium">{String(brief.project_name)}</p>
          </div>
        )}
        {brief.duration && (
          <div>
            <p className="text-gray-500">时长</p>
            <p>{String(brief.duration)}</p>
          </div>
        )}
        {brief.style_guide && typeof brief.style_guide === 'object' && (
          <div className="col-span-2">
            <p className="text-gray-500 mb-1">视觉风格</p>
            <div className="glass p-2 rounded-lg">
              {Object.entries(brief.style_guide as Record<string, string | string[]>).map(([k, v]) => (
                <p key={k} className="text-xs">
                  <span className="text-gray-500">{formatKey(k)}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {brief.core_storyline && (
        <div>
          <p className="text-xs text-gray-500 mb-1">核心剧情</p>
          <p className="text-sm">{String(brief.core_storyline)}</p>
        </div>
      )}
      
      {brief.target_audience && (
        <div className="flex gap-4 text-xs">
          <div>
            <p className="text-gray-500">目标受众</p>
            <p>{String(brief.target_audience)}</p>
          </div>
          {brief.tone && (
            <div>
              <p className="text-gray-500">情感基调</p>
              <p>{String(brief.tone)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 项目规划卡片
export function ProjectPlanCard({ data }: { data: Record<string, unknown> }) {
  const projectName = data.project_name as string | undefined
  const styleGuide = data.style_guide as Record<string, string | string[]> | undefined
  const coreStoryline = data.core_storyline as string | undefined
  
  return (
    <div className="glass p-4 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-purple-400" />
        <span className="font-semibold text-white">项目规划</span>
      </div>
      
      {projectName && (
        <p className="text-lg font-medium text-white">{projectName}</p>
      )}
      
      {styleGuide && typeof styleGuide === 'object' && (
        <div className="glass p-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-2">视觉风格指南</p>
          {Object.entries(styleGuide).map(([k, v]) => (
            <div key={k} className="text-xs mb-1">
              <span className="text-gray-400">{formatKey(k)}:</span>{' '}
              <span>{Array.isArray(v) ? v.join(', ') : String(v)}</span>
            </div>
          ))}
        </div>
      )}
      
      {coreStoryline && (
        <div>
          <p className="text-xs text-gray-500 mb-1">剧情概要</p>
          <p className="text-sm">{coreStoryline}</p>
        </div>
      )}
    </div>
  )
}

// 下一步选项卡片
export function NextOptionsCard({ data }: { data: Record<string, unknown> }) {
  const options = data.next_options as string[]
  
  return (
    <div className="glass p-4 rounded-xl">
      <p className="text-xs text-gray-500 mb-3">接下来你可以选择：</p>
      <div className="space-y-2">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">
              {idx + 1}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 格式化 key 名称
function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}
