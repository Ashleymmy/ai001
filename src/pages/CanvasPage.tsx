import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'

const DEFAULT_HUOBAO_BASE_URL = 'http://localhost:5678'

export default function CanvasPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const urlProjectId = location.pathname.match(/\/canvas\/([^/]+)/)?.[1] || null
  const backTarget = urlProjectId ? `/home/project/${urlProjectId}` : '/home'

  const huobaoBaseUrl = (import.meta.env.VITE_HUOBAO_BASE_URL as string | undefined) || DEFAULT_HUOBAO_BASE_URL

  const iframeUrl = useMemo(() => {
    try {
      const url = new URL(huobaoBaseUrl)
      if (urlProjectId) url.searchParams.set('fromProjectId', urlProjectId)
      return url.toString()
    } catch {
      return DEFAULT_HUOBAO_BASE_URL
    }
  }, [huobaoBaseUrl, urlProjectId])

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#0a0a12]"
      style={{ overflow: 'hidden', position: 'fixed', top: 0, left: 0 }}
    >
      <div className="flex items-center gap-3 px-4 py-3 glass-dark border-b border-white/5">
        <button
          onClick={() => navigate(backTarget)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl glass-button hover:bg-white/10 transition-all text-sm"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        <div className="text-sm text-gray-400 truncate">
          短剧工作台（Demo）· {huobaoBaseUrl}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={iframeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-xl glass-button hover:bg-white/10 transition-all text-sm"
          >
            <ExternalLink size={16} />
            新窗口打开
          </a>
        </div>
      </div>

      <iframe
        title="Huobao Drama"
        src={iframeUrl}
        className="flex-1 w-full min-h-0 bg-white"
        style={{ border: 'none' }}
      />

      <div className="px-4 py-2 text-xs text-gray-500 border-t border-white/5 bg-black/20">
        若页面打不开，请确认 demo Go 服务已启动：`demo/huobao-drama` 下运行 `go run main.go`，并检查
        `http://localhost:5678/health`。
      </div>
    </div>
  )
}
