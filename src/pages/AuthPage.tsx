/**
 * 功能模块：页面模块，负责 AuthPage 场景的页面布局与交互编排
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspaceStore'

type AuthMode = 'login' | 'register' | 'forgot'

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
    logout,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
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
    logout: state.logout,
    updateProfile: state.updateProfile,
    changePassword: state.changePassword,
    forgotPassword: state.forgotPassword,
    resetPassword: state.resetPassword,
    clearError: state.clearError,
  }))

  const [mode, setMode] = useState<AuthMode>('login')

  // login/register
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  // forgot/reset
  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')

  // profile/change-password
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!initialized) {
      void init()
    }
  }, [init, initialized])

  useEffect(() => {
    if (!user) return
    setProfileName(user.name || '')
    setProfileEmail(user.email || '')
  }, [user])

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setNotice('')
    clearError()
  }

  const handleSubmitAuth = async () => {
    const nextEmail = email.trim()
    if (!nextEmail || !password.trim()) return
    if (mode === 'register' && password !== passwordConfirm) {
      setNotice('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      if (mode === 'register') {
        await register(name.trim() || nextEmail.split('@')[0], nextEmail, password)
      } else {
        await login(nextEmail, password)
      }
      navigate('/studio', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestReset = async () => {
    const nextEmail = resetEmail.trim()
    if (!nextEmail) return
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      const token = await forgotPassword(nextEmail)
      if (token) {
        setResetToken(token)
        setNotice(`重置口令已生成（开发模式可见）：${token}`)
      } else {
        setNotice('已提交重置请求，请按你的通知渠道获取重置口令。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetToken.trim() || !resetPasswordValue.trim()) return
    if (resetPasswordValue !== resetPasswordConfirm) {
      setNotice('两次输入的新密码不一致')
      return
    }
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      await resetPassword(resetToken.trim(), resetPasswordValue)
      setResetPasswordValue('')
      setResetPasswordConfirm('')
      setPassword('')
      setPasswordConfirm('')
      switchMode('login')
      setNotice('密码已重置，请使用新密码登录。')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateProfile = async () => {
    const nextName = profileName.trim()
    const nextEmail = profileEmail.trim()
    if (!nextName || !nextEmail) return
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      await updateProfile({ name: nextName, email: nextEmail })
      setNotice('账号资料已更新')
    } finally {
      setSubmitting(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) return
    if (newPassword !== newPasswordConfirm) {
      setNotice('两次输入的新密码不一致')
      return
    }
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
      setNotice('密码修改成功，请重新登录以刷新会话。')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    setSubmitting(true)
    setNotice('')
    clearError()
    try {
      await logout()
      setMode('login')
    } finally {
      setSubmitting(false)
    }
  }

  if (!initialized || (loading && !user)) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-200 text-sm">
        正在初始化协作上下文...
      </div>
    )
  }

  if (user) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center p-4 text-gray-100">
        <div className="w-full max-w-xl border border-gray-800 bg-gray-900/80 rounded-xl p-5 space-y-5">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">账号管理</h1>
            <p className="text-xs text-gray-400">你已登录，可在此更新资料、修改密码或退出登录。</p>
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/70 p-3 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-400">昵称</label>
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">邮箱</label>
                <input
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
              <span>模式：{authRequired ? '账号认证模式' : '本地协作模式'}</span>
              <button
                onClick={() => void handleUpdateProfile()}
                disabled={submitting || !profileName.trim() || !profileEmail.trim()}
                className="rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-xs text-white transition-colors"
              >
                保存资料
              </button>
            </div>
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/70 p-3 space-y-2 text-sm">
            <p className="text-xs text-gray-400">修改密码</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={currentPassword}
                type="password"
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="当前密码"
              />
              <input
                value={newPassword}
                type="password"
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="新密码（至少 6 位）"
              />
              <input
                value={newPasswordConfirm}
                type="password"
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="确认新密码"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void handleChangePassword()}
                disabled={submitting || !currentPassword.trim() || !newPassword.trim() || !newPasswordConfirm.trim()}
                className="rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-1.5 text-xs text-white transition-colors"
              >
                修改密码
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-300 border border-red-800/70 bg-red-900/20 rounded px-2 py-1.5">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-xs text-emerald-300 border border-emerald-800/70 bg-emerald-900/20 rounded px-2 py-1.5">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate('/studio')}
              className="rounded bg-purple-600 hover:bg-purple-500 px-3 py-2 text-sm font-medium transition-colors"
            >
              返回工作台
            </button>
            <button
              onClick={() => void handleLogout()}
              disabled={submitting}
              className="rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-3 py-2 text-sm font-medium transition-colors"
            >
              {submitting ? '处理中...' : '退出登录'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center p-4 text-gray-100">
      <div className="w-full max-w-md border border-gray-800 bg-gray-900/80 rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">协作空间账号</h1>
          <p className="text-xs text-gray-400">登录后可使用工作区、成员、OKR 与撤销重做能力</p>
        </div>

        <div className="flex gap-2 rounded bg-gray-800 p-1 text-xs">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 rounded px-3 py-1.5 transition-colors ${mode === 'login' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            登录
          </button>
          <button
            onClick={() => switchMode('register')}
            className={`flex-1 rounded px-3 py-1.5 transition-colors ${mode === 'register' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            注册
          </button>
          <button
            onClick={() => switchMode('forgot')}
            className={`flex-1 rounded px-3 py-1.5 transition-colors ${mode === 'forgot' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            重置密码
          </button>
        </div>

        {mode !== 'forgot' && (
          <>
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

            {mode === 'register' && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400">确认密码</label>
                <input
                  value={passwordConfirm}
                  type="password"
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  placeholder="再次输入密码"
                />
              </div>
            )}

            <button
              onClick={() => void handleSubmitAuth()}
              disabled={submitting || !email.trim() || !password.trim() || (mode === 'register' && !passwordConfirm.trim())}
              className="w-full rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-2 text-sm font-medium transition-colors"
            >
              {submitting ? '提交中...' : mode === 'register' ? '注册并进入工作台' : '登录并进入工作台'}
            </button>
          </>
        )}

        {mode === 'forgot' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">账号邮箱</label>
              <input
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="name@example.com"
              />
            </div>
            <button
              onClick={() => void handleRequestReset()}
              disabled={submitting || !resetEmail.trim()}
              className="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 text-sm font-medium transition-colors"
            >
              {submitting ? '提交中...' : '发送重置请求'}
            </button>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">重置口令</label>
              <input
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="输入收到的 reset token"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">新密码</label>
              <input
                value={resetPasswordValue}
                type="password"
                onChange={(e) => setResetPasswordValue(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="至少 6 位"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">确认新密码</label>
              <input
                value={resetPasswordConfirm}
                type="password"
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="再次输入新密码"
              />
            </div>

            <button
              onClick={() => void handleResetPassword()}
              disabled={submitting || !resetToken.trim() || !resetPasswordValue.trim() || !resetPasswordConfirm.trim()}
              className="w-full rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-2 text-sm font-medium transition-colors"
            >
              {submitting ? '重置中...' : '确认重置密码'}
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-300 border border-red-800/70 bg-red-900/20 rounded px-2 py-1.5">
            {error}
          </div>
        )}
        {notice && (
          <div className="text-xs text-emerald-300 border border-emerald-800/70 bg-emerald-900/20 rounded px-2 py-1.5 break-all">
            {notice}
          </div>
        )}
      </div>
    </div>
  )
}
