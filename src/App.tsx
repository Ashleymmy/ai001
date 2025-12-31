import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import ScriptPage from './pages/ScriptPage'
import ImagePage from './pages/ImagePage'
import StoryboardPage from './pages/StoryboardPage'
import VideoPage from './pages/VideoPage'
import SettingsPage from './pages/SettingsPage'
import { useSettingsStore } from './store/settingsStore'

function App() {
  const loadFromBackend = useSettingsStore((state) => state.loadFromBackend)

  // 启动时从后端加载设置
  useEffect(() => {
    loadFromBackend()
  }, [loadFromBackend])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="script" element={<ScriptPage />} />
          <Route path="image" element={<ImagePage />} />
          <Route path="storyboard" element={<StoryboardPage />} />
          <Route path="storyboard/:projectId" element={<StoryboardPage />} />
          <Route path="video" element={<VideoPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* 兼容旧路由 */}
          <Route path="editor" element={<StoryboardPage />} />
          <Route path="editor/:projectId" element={<StoryboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
