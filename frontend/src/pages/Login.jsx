import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleOutlined, GithubOutlined } from '@ant-design/icons'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { login } from '../api'
import './login.css'

// 产品实况 mock：TOP 5 排名柱（第一名高亮），数值与 ¥1.28M 总量大致自洽
const MOCK_BARS = [
  { h: 92, label: '¥412K' },
  { h: 68, label: '¥305K' },
  { h: 54, label: '¥239K' },
  { h: 41, label: '¥182K' },
  { h: 30, label: '¥134K' },
]

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)

  // ¥1.28M 从 0 计数上来的微动画（reduced-motion 直接出终值）
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(1.28)
      return
    }
    const TARGET = 1.28
    const DURATION = 1300
    const DELAY = 500
    let raf
    let t0
    const tick = (now) => {
      if (t0 === undefined) t0 = now
      const t = Math.min(1, (now - t0 - DELAY) / DURATION)
      const eased = t <= 0 ? 0 : 1 - Math.pow(1 - t, 3)
      setCount(TARGET * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await login({ email: email.trim(), password })
      if (data?.token) {
        localStorage.setItem('askdata_token', data.token)
        localStorage.setItem('askdata_user', JSON.stringify(data.user ?? {}))
      }
      navigate('/chat')
    } catch (err) {
      setError(err?.response?.data?.detail ?? '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <aside className="brand">
        <div className="brand-inner">
          <div className="brand-head">
            <img className="brand-mark" src="/dog.png" alt="DeepData" />
            <span className="brand-name deepdata-word">deepdata</span>
          </div>

          <h1 className="brand-pitch">用一句话，问清你的数据</h1>
          <p className="brand-sub">
            自然语言提问，自动生成查询与图表。像聊天一样分析数据。
          </p>

          <div className="product-mock" aria-hidden="true">
            <div className="mock-q">
              <span className="mock-q-tag">问</span>
              <span className="mock-q-text">上月销售额前五的产品</span>
            </div>

            <div className="mock-stats">
              <span className="mock-num">¥{count.toFixed(2)}M</span>
              <span className="mock-delta">+12.4% 环比</span>
            </div>

            <div className="mock-chart">
              {MOCK_BARS.map((b, i) => (
                <span
                  key={i}
                  data-label={b.label}
                  className={`mock-bar${i === 0 ? ' top' : ''}`}
                  style={{ height: `${b.h}%`, animationDelay: `${0.9 + i * 0.07}s` }}
                />
              ))}
            </div>
            <div className="mock-idx">
              <span>01</span>
              <span>02</span>
              <span>03</span>
              <span>04</span>
              <span>05</span>
            </div>

            <div className="mock-meta">1 条 SQL 查询 · 386 ms · 5 条记录</div>
          </div>
        </div>
      </aside>

      <main className="panel">
        <div className="form-card">
          <h2 className="form-title">欢迎回来</h2>
          <p className="form-sub">登录后继续你的数据提问</p>

          <form onSubmit={submit}>
            <label className="field-label" htmlFor="email">邮箱</label>
            <input
              id="email"
              className="field"
              type="email"
              placeholder="you@example.com"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="field-label" htmlFor="password">密码</label>
            <div className="pwd-wrap">
              <input
                id="password"
                className="field"
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="pwd-toggle"
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPwd((s) => !s)}
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <div className="form-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>记住我</span>
              </label>
              <a className="forgot" href="#" aria-disabled="true" onClick={(e) => e.preventDefault()}>
                忘记密码？
              </a>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="cta">
              <button className="submit" type="submit" disabled={loading}>
                {loading ? '登录中…' : '登录'}
              </button>
            </div>
          </form>

          <div className="divider"><span>或</span></div>

          <div className="sso-row">
            <button className="sso" type="button" disabled aria-disabled="true">
              <GoogleOutlined /> Google
              <span className="sso-soon">即将上线</span>
            </button>
            <button className="sso" type="button" disabled aria-disabled="true">
              <GithubOutlined /> GitHub
              <span className="sso-soon">即将上线</span>
            </button>
          </div>

          <p className="trust">
            <Lock className="lock" size={13} aria-hidden="true" /> 由 DeepData 安全连接你的数据源
          </p>
          <p className="register">
            还没有账号？
            <a href="#" aria-disabled="true" onClick={(e) => e.preventDefault()}>
              免费注册
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
