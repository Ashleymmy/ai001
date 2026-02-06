import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import WelcomePage from './pages/WelcomePage'
import HomePage from './pages/HomePage'
import ScriptPage from './pages/ScriptPage'
import ImagePage from './pages/ImagePage'
import StoryboardPage from './pages/StoryboardPage'
import VideoPage from './pages/VideoPage'
import SettingsPage from './pages/SettingsPage'
import AgentPage from './pages/AgentPage'
import CanvasPage from './pages/CanvasPage'
import ProjectPage from './pages/ProjectPage'
import { useSettingsStore } from './store/settingsStore'

// 首次访问检测 key
const VISITED_KEY = 'ai-storyboarder-visited'

// 检查是否已访问过
export const hasVisited = () => localStorage.getItem(VISITED_KEY) === 'true'

// 设置已访问标记
export const setVisited = () => localStorage.setItem(VISITED_KEY, 'true')

// 清除已访问标记（用于返回欢迎页）
export const clearVisited = () => localStorage.removeItem(VISITED_KEY)

// 路由守卫组件 - 首次访问重定向到欢迎页
function RequireVisited({ children }: { children: React.ReactNode }) {
  if (!hasVisited()) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

// 需要保持状态的页面列表
const KEEP_ALIVE_ROUTES = ['/home/script', '/home/image', '/home/storyboard', '/home/video']

function getKeepAliveKey(pathname: string): string | null {
  return KEEP_ALIVE_ROUTES.find((route) => pathname.startsWith(route)) || null
}

// 页面缓存组件
function KeepAliveOutlet() {
  const location = useLocation()
  const [visitedRoutes, setVisitedRoutes] = useState<Set<string>>(new Set())

  useEffect(() => {
    const routeKey = getKeepAliveKey(location.pathname)
    // 只缓存需要保持状态的页面（按路由 key 缓存，避免 /storyboard/:id 缓存失效）
    if (routeKey) {
      setVisitedRoutes(prev => new Set([...prev, routeKey]))
    }
  }, [location.pathname])

  const currentPath = location.pathname

  // 渲染所有访问过的需要缓存的页面
  return (
    <>
      {/* 首页 - 不缓存 */}
      <div style={{ display: currentPath === '/home' ? 'block' : 'none', height: '100%' }}>
        {currentPath === '/home' && <HomePage />}
      </div>

      {/* 剧本页 - 缓存 */}
      <div style={{ display: currentPath === '/home/script' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/home/script') || currentPath === '/home/script') && <ScriptPage />}
      </div>

      {/* 图像页 - 缓存 */}
      <div style={{ display: currentPath === '/home/image' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/home/image') || currentPath === '/home/image') && <ImagePage />}
      </div>

      {/* 分镜页 - 缓存 */}
      <div style={{ display: currentPath.startsWith('/home/storyboard') ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/home/storyboard') || currentPath.startsWith('/home/storyboard')) && <StoryboardPage />}
      </div>

      {/* 视频页 - 缓存 */}
      <div style={{ display: currentPath === '/home/video' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/home/video') || currentPath === '/home/video') && <VideoPage />}
      </div>

      {/* 设置页 - 不缓存 */}
      <div style={{ display: currentPath === '/home/settings' ? 'block' : 'none', height: '100%' }}>
        {currentPath === '/home/settings' && <SettingsPage />}
      </div>

      {/* 项目页 - 不缓存 */}
      <div style={{ display: currentPath.startsWith('/home/project/') ? 'block' : 'none', height: '100%' }}>
        {currentPath.startsWith('/home/project/') && <ProjectPage />}
      </div>
    </>
  )
}

// 带缓存的 Layout
function LayoutWithKeepAlive() {
  return (
    <Layout>
      <KeepAliveOutlet />
    </Layout>
  )
}

function App() {
  const loadFromBackend = useSettingsStore((state) => state.loadFromBackend)

  // 启动时从后端加载设置 - 只执行一次
  useEffect(() => {
    loadFromBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <HashRouter>
      <Routes>
        {/* 欢迎页 - 独立布局，无侧边栏 */}
        <Route path="/" element={<WelcomePage />} />
        {/* 主应用页面 - 带 Layout，需要首次访问检测 */}
        <Route path="/home/*" element={<RequireVisited><LayoutWithKeepAlive /></RequireVisited>} />
        {/* Agent 模式 - 独立布局，需要首次访问检测 */}
        <Route path="agent" element={<RequireVisited><AgentPage /></RequireVisited>} />
        <Route path="agent/:projectId" element={<RequireVisited><AgentPage /></RequireVisited>} />
        {/* Canvas 画布模式，需要首次访问检测 */}
        <Route path="canvas" element={<RequireVisited><CanvasPage /></RequireVisited>} />
        <Route path="canvas/:projectId" element={<RequireVisited><CanvasPage /></RequireVisited>} />
      </Routes>
    </HashRouter>
  )
}

export default App
