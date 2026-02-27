import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspaceStore'

export default function AuthPage() {
  const navigate = useNavigate()
  const {
    initialized,
    loading,
    authRequired,
    user,
    error,
    init,
    login,
    register,
    clearError,
  } = useWorkspaceStore((state) => ({
    initialized: state.initialized,
    loading: state.loading,
    authRequired: state.authRequired,
    user: state.user,
    error: state.error,
    init: state.init,
    login: state.login,
    register: state.register,
    clearError: state.clearError,
  }))

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!initialized) {
      void init()
    }
  }, [init, initialized])

  useEffect(() => {
    if (user) {
      navigate('/studio', { replace: true })
    }
  }, [navigate, user])

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    clearError()
    try {
      if (mode === 'register') {
        await register(name.trim() || email.split('@')[0], email.trim(), password)
      } else {
        await login(email.trim(), password)
      }
      navigate('/studio', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (!initialized || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-200 text-sm">
        正在初始化协作上下文...
      </div>
    )
  }

  if (!authRequired && user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-200 text-sm">
        本地协作模式已启用，正在进入工作台...
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center p-4 text-gray-100">
      <div className="w-full max-w-md border border-gray-800 bg-gray-900/80 rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">协作空间登录</h1>
          <p className="text-xs text-gray-400">登录后可使用工作区、成员、OKR 与撤销重做能力</p>
        </div>

        <div className="flex gap-2 rounded bg-gray-800 p-1 text-xs">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 rounded px-3 py-1.5 transition-colors ${mode === 'login' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            登录
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 rounded px-3 py-1.5 transition-colors ${mode === 'register' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            注册
          </button>
        </div>

        {mode === 'register' && (
          <div className="space-y-1">
            <label className="text-xs text-gray-400">昵称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              placeholder="你的名称"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs text-gray-400">邮箱</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            placeholder="name@example.com"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-400">密码</label>
          <input
            value={password}
            type="password"
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            placeholder="至少 6 位"
          />
        </div>

        {error && (
          <div className="text-xs text-red-300 border border-red-800/70 bg-red-900/20 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={submitting || !email.trim() || !password.trim()}
          className="w-full rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-2 text-sm font-medium transition-colors"
        >
          {submitting ? '提交中...' : mode === 'register' ? '注册并进入工作台' : '登录并进入工作台'}
        </button>
      </div>
    </div>
  )
}
