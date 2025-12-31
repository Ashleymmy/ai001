import { useNavigate } from 'react-router-dom'
import { FileText, Image, Film, Video, Clock, ArrowRight } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'

const MODULES = [
  {
    id: 'script',
    name: '剧本创作',
    description: '创作和编辑剧本、故事大纲',
    icon: FileText,
    color: 'from-blue-500 to-cyan-500',
    path: '/script'
  },
  {
    id: 'image',
    name: '图像生成',
    description: '生成和编辑 AI 图像',
    icon: Image,
    color: 'from-purple-500 to-pink-500',
    path: '/image'
  },
  {
    id: 'storyboard',
    name: '分镜制作',
    description: '将剧本转化为分镜画面',
    icon: Film,
    color: 'from-orange-500 to-yellow-500',
    path: '/storyboard'
  },
  {
    id: 'video',
    name: '视频生成',
    description: '将分镜图片生成视频',
    icon: Video,
    color: 'from-green-500 to-emerald-500',
    path: '/video'
  }
]

export default function HomePage() {
  const navigate = useNavigate()
  const { recentProjects } = useProjectStore()

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* 头部 */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2">AI Storyboarder</h1>
        <p className="text-gray-400">视频分镜制作助手 - 从创意到画面，一站式创作</p>
      </div>

      {/* 功能模块 */}
      <div className="mb-12">
        <h2 className="text-lg font-semibold mb-4">创作工具</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {MODULES.map((module) => (
            <button
              key={module.id}
              onClick={() => navigate(module.path)}
              className="group relative p-6 bg-[#1a1a1a] rounded-xl border border-gray-800 hover:border-gray-600 transition-all text-left overflow-hidden"
            >
              {/* 背景渐变 */}
              <div className={`absolute inset-0 bg-gradient-to-br ${module.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
              
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${module.color} flex items-center justify-center mb-4`}>
                <module.icon size={24} className="text-white" />
              </div>
              
              <h3 className="font-semibold mb-1">{module.name}</h3>
              <p className="text-sm text-gray-500">{module.description}</p>
              
              <ArrowRight 
                size={18} 
                className="absolute bottom-4 right-4 text-gray-600 group-hover:text-white group-hover:translate-x-1 transition-all" 
              />
            </button>
          ))}
        </div>
      </div>

      {/* 快速开始 */}
      <div className="mb-12">
        <h2 className="text-lg font-semibold mb-4">快速开始</h2>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => navigate('/storyboard')}
            className="p-4 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-xl border border-primary/30 hover:border-primary/60 transition-all text-left"
          >
            <h3 className="font-medium mb-1">新建分镜项目</h3>
            <p className="text-sm text-gray-400">从剧本开始创建分镜</p>
          </button>
          
          <button
            onClick={() => navigate('/script')}
            className="p-4 bg-[#1a1a1a] rounded-xl border border-gray-800 hover:border-gray-600 transition-all text-left"
          >
            <h3 className="font-medium mb-1">AI 写剧本</h3>
            <p className="text-sm text-gray-400">让 AI 帮你构思故事</p>
          </button>
          
          <button
            onClick={() => navigate('/image')}
            className="p-4 bg-[#1a1a1a] rounded-xl border border-gray-800 hover:border-gray-600 transition-all text-left"
          >
            <h3 className="font-medium mb-1">生成概念图</h3>
            <p className="text-sm text-gray-400">快速生成参考画面</p>
          </button>
        </div>
      </div>

      {/* 最近项目 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Clock size={18} className="text-gray-400" />
          <h2 className="text-lg font-semibold">最近项目</h2>
        </div>
        
        {recentProjects.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-[#1a1a1a] rounded-xl border border-gray-800">
            <p>暂无最近项目</p>
            <p className="text-sm mt-1">选择上方工具开始创作</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {recentProjects.slice(0, 4).map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/storyboard/${project.id}`)}
                className="p-4 bg-[#1a1a1a] rounded-xl border border-gray-800 hover:border-gray-600 cursor-pointer transition-all"
              >
                <div className="aspect-video bg-gray-800 rounded-lg mb-3" />
                <h3 className="font-medium truncate">{project.name}</h3>
                <p className="text-sm text-gray-500">{project.updatedAt}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
