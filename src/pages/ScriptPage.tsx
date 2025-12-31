import { useState } from 'react'
import { Save, Download, FileText, Wand2 } from 'lucide-react'
import ModuleChat from '../components/ModuleChat'

export default function ScriptPage() {
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('未命名剧本')

  const handleExport = () => {
    const blob = new Blob([`# ${title}\n\n${script}`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full">
      {/* 左侧编辑区 */}
      <div className="flex-1 flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-blue-400" />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent text-lg font-semibold focus:outline-none border-b border-transparent focus:border-gray-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors">
              <Save size={16} />
              保存
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#252525] rounded-lg text-sm hover:bg-[#303030] transition-colors"
            >
              <Download size={16} />
              导出
            </button>
          </div>
        </div>

        {/* 编辑器 */}
        <div className="flex-1 p-6">
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="在这里编写你的剧本...

可以包含：
- 场景描述
- 角色对白
- 动作指示
- 镜头说明

或者在右侧与 AI 助手对话，让它帮你构思和完善剧本。"
            className="w-full h-full bg-[#1a1a1a] rounded-xl p-4 text-sm resize-none border border-gray-800 focus:border-primary/50 focus:outline-none leading-relaxed"
          />
        </div>

        {/* 底部状态栏 */}
        <div className="px-6 py-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
          <span>{script.length} 字</span>
          <span>按 Ctrl+S 保存</span>
        </div>
      </div>

      {/* 右侧 AI 对话 */}
      <div className="w-96 border-l border-gray-800 flex flex-col">
        <ModuleChat 
          moduleType="script" 
          placeholder="描述你的故事创意，或让 AI 帮你续写..."
          context={script ? `当前剧本内容：${script.slice(0, 500)}...` : undefined}
        />
      </div>
    </div>
  )
}
