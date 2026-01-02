import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
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

// 需要保持状态的页面列表
const KEEP_ALIVE_ROUTES = ['/script', '/image', '/storyboard', '/video']

// 页面缓存组件
function KeepAliveOutlet() {
  const location = useLocation()
  const [visitedRoutes, setVisitedRoutes] = useState<Set<string>>(new Set())
  
  useEffect(() => {
    const path = location.pathname
    // 只缓存需要保持状态的页面
    if (KEEP_ALIVE_ROUTES.some(route => path.startsWith(route))) {
      setVisitedRoutes(prev => new Set([...prev, path]))
    }
  }, [location.pathname])

  const currentPath = location.pathname

  // 渲染所有访问过的需要缓存的页面
  return (
    <>
      {/* 首页 - 不缓存 */}
      <div style={{ display: currentPath === '/' ? 'block' : 'none', height: '100%' }}>
        {currentPath === '/' && <HomePage />}
      </div>

      {/* 剧本页 - 缓存 */}
      <div style={{ display: currentPath === '/script' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/script') || currentPath === '/script') && <ScriptPage />}
      </div>

      {/* 图像页 - 缓存 */}
      <div style={{ display: currentPath === '/image' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/image') || currentPath === '/image') && <ImagePage />}
      </div>

      {/* 分镜页 - 缓存 */}
      <div style={{ display: currentPath.startsWith('/storyboard') ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/storyboard') || currentPath.startsWith('/storyboard')) && <StoryboardPage />}
      </div>

      {/* 视频页 - 缓存 */}
      <div style={{ display: currentPath === '/video' ? 'block' : 'none', height: '100%' }}>
        {(visitedRoutes.has('/video') || currentPath === '/video') && <VideoPage />}
      </div>

      {/* 设置页 - 不缓存 */}
      <div style={{ display: currentPath === '/settings' ? 'block' : 'none', height: '100%' }}>
        {currentPath === '/settings' && <SettingsPage />}
      </div>

      {/* 项目页 - 不缓存 */}
      <div style={{ display: currentPath.startsWith('/project/') ? 'block' : 'none', height: '100%' }}>
        {currentPath.startsWith('/project/') && <ProjectPage />}
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
        <Route path="/*" element={<LayoutWithKeepAlive />} />
        {/* Agent 模式 - 独立布局 */}
        <Route path="agent" element={<AgentPage />} />
        <Route path="agent/:projectId" element={<AgentPage />} />
        {/* Canvas 画布模式 */}
        <Route path="canvas" element={<CanvasPage />} />
        <Route path="canvas/:projectId" element={<CanvasPage />} />
      </Routes>
    </HashRouter>
  )
}

export default App
