import { Outlet, NavLink } from 'react-router-dom'
import { Home, FileText, Image, Film, Video, Settings } from 'lucide-react'
import AIChatPanel from './AIChatPanel'

export default function Layout() {
  const navItems = [
    { to: '/', icon: Home, label: '首页' },
    { to: '/script', icon: FileText, label: '剧本' },
    { to: '/image', icon: Image, label: '图像' },
    { to: '/storyboard', icon: Film, label: '分镜' },
    { to: '/video', icon: Video, label: '视频' },
    { to: '/settings', icon: Settings, label: '设置' }
  ]

  return (
    <div className="flex h-screen bg-[#0f0f0f]">
      {/* 侧边栏 */}
      <aside className="w-16 bg-[#1a1a1a] flex flex-col items-center py-4 border-r border-gray-800">
        <div className="text-2xl font-bold text-primary mb-6">S</div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `p-3 rounded-lg transition-colors relative group ${
                  isActive
                    ? 'bg-primary/20 text-primary'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
              title={label}
            >
              <Icon size={20} />
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {label}
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* 悬浮创意助手 */}
      <AIChatPanel />
    </div>
  )
}
