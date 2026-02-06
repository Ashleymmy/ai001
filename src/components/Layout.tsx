import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Home, FileText, Image, Film, Video, Settings, ChevronLeft } from 'lucide-react'
import AIChatPanel from './AIChatPanel'
import { ReactNode } from 'react'
import { clearVisited } from '../App'

interface LayoutProps {
  children?: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  
  const navItems = [
    { to: '/home', icon: Home, label: '首页', gradient: 'from-blue-500 to-cyan-400' },
    { to: '/home/script', icon: FileText, label: '剧本', gradient: 'from-violet-500 to-purple-400' },
    { to: '/home/image', icon: Image, label: '图像', gradient: 'from-pink-500 to-rose-400' },
    { to: '/home/storyboard', icon: Film, label: '分镜', gradient: 'from-orange-500 to-amber-400' },
    { to: '/home/video', icon: Video, label: '视频', gradient: 'from-green-500 to-emerald-400' },
    { to: '/home/settings', icon: Settings, label: '设置', gradient: 'from-slate-500 to-gray-400' }
  ]

  const isStandaloneModuleRoute = [
    '/home/script',
    '/home/image',
    '/home/storyboard',
    '/home/video'
  ].some((route) => location.pathname.startsWith(route))

  const isSubPage = location.pathname !== '/home'

  // 双击 Logo 返回欢迎页
  const handleLogoDoubleClick = () => {
    clearVisited()
    navigate('/')
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-[#0a0a12] via-[#0f0f1a] to-[#0a0a15]">
      {/* 背景光效 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 w-72 h-72 bg-cyan-500/8 rounded-full blur-[100px]" />
      </div>

      {/* 侧边栏 */}
      <aside className="w-[72px] glass-dark m-3 rounded-2xl flex flex-col items-center py-5 animate-slideInLeft relative z-10">
        {/* Logo / 返回按钮 */}
        {isSubPage ? (
          <button
            onClick={() => navigate('/home')}
            className="w-11 h-11 rounded-xl glass-button flex items-center justify-center mb-6 hover:bg-white/10 transition-apple group"
            title="返回首页"
          >
            <ChevronLeft size={20} className="text-gray-400 group-hover:text-white transition-colors" />
          </button>
        ) : (
          <div
            onDoubleClick={handleLogoDoubleClick}
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center mb-6 shadow-lg shadow-purple-500/30 animate-float cursor-pointer"
            title="双击返回欢迎页"
          >
            <span className="text-xl font-bold text-white drop-shadow-lg">S</span>
          </div>
        )}
        
        {/* 导航 */}
        <nav className="flex flex-col gap-1.5 flex-1">
          {navItems.map(({ to, icon: Icon, label, gradient }, index) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/home'}
              className={({ isActive }) =>
                `relative p-2.5 rounded-xl transition-apple group ${
                  isActive ? '' : 'hover:bg-white/5'
                }`
              }
              title={label}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`} style={{ boxShadow: `0 4px 15px rgba(0,0,0,0.3)` }}>
                      <Icon size={18} className="text-white drop-shadow" strokeWidth={2.5} />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 group-hover:text-gray-300 transition-colors">
                      <Icon size={18} strokeWidth={2} />
                    </div>
                  )}
                  {/* 活跃指示器 */}
                  {isActive && (
                    <div className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-gradient-to-b ${gradient} animate-scaleIn`} />
                  )}
                  {/* Tooltip */}
                  <span className="absolute left-full ml-3 px-3 py-1.5 glass-dark rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-apple pointer-events-none z-50 font-medium">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        
        {/* 底部装饰 */}
        <div className="w-8 h-1 rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden m-3 ml-0 rounded-2xl glass animate-fadeIn relative z-10">
        {children}
      </main>

      {/* 悬浮创意助手（独立模块页不显示，避免与 Agent 通道混用） */}
      {!isStandaloneModuleRoute && <AIChatPanel />}
    </div>
  )
}
