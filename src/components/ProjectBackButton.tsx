import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FolderOpen } from 'lucide-react'

interface ProjectBackButtonProps {
  className?: string
  projectId?: string  // 可以直接传入 projectId
}

export default function ProjectBackButton({ className = '', projectId: propProjectId }: ProjectBackButtonProps) {
  const navigate = useNavigate()
  const location = useLocation()
  
  // 优先使用传入的 projectId，其次从 URL 参数获取，最后从查询参数获取
  const searchParams = new URLSearchParams(location.search)
  const queryProjectId = searchParams.get('project')
  
  // 从路径中提取 projectId (支持 /storyboard/:id, /agent/:id, /canvas/:id 格式)
  const pathMatch = location.pathname.match(/\/(storyboard|agent|canvas)\/([^/]+)/)
  const pathProjectId = pathMatch ? pathMatch[2] : null
  
  const projectId = propProjectId || pathProjectId || queryProjectId
  
  // 如果没有项目上下文，不显示
  if (!projectId) return null
  
  const handleBack = () => {
    navigate(`/home/project/${projectId}`)
  }
  
  return (
    <button
      onClick={handleBack}
      className={`flex items-center gap-2 px-3 py-1.5 glass-button rounded-xl text-sm hover:bg-white/10 transition-all ${className}`}
      title="返回项目"
    >
      <ArrowLeft size={16} />
      <FolderOpen size={14} className="text-blue-400" />
      <span className="text-gray-400">返回项目</span>
    </button>
  )
}
