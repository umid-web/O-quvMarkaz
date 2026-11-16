
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import './Login.scss'
import { loginToBackend } from '../api/backend'


function Login() {
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentYear] = useState(() => new Date().getFullYear())
  const submitting = useRef(false)

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (submitting.current) return

    setError('')

    const trimmedUsername = username.trim()

    if (!trimmedUsername || !password) {
      setError('Login va parolni kiriting.')
      return
    }

    submitting.current = true
    setLoading(true)
    try {
      const user = await loginToBackend(trimmedUsername, password)
      setPassword('')
      const destination = user.roleId === 'reception' ? '/reception' : user.roleId === 'teacher' ? '/teacher' : '/admin'
      navigate(destination, { replace: true })
    } catch (loginError) {
      setError(loginError.message || 'Login yoki parol xato.')
      setLoading(false)
    } finally {
      submitting.current = false
    }
  }

  const handleUsernameChange = (event) => {
    setUsername(event.target.value)
    if (error) setError('')
  }

  const handlePasswordChange = (event) => {
    setPassword(event.target.value)
    if (error) setError('')
  }

  return (
    <main className="login-page">
      <span
        className="login-page__glow login-page__glow--one"
        aria-hidden="true"
      />
      <span
        className="login-page__glow login-page__glow--two"
        aria-hidden="true"
      />

      <section className="login-card" aria-labelledby="login-title">
        <header className="login-brand">
          <div className="login-brand__icon">
            <ShieldCheck size={26} strokeWidth={2.2} />
          </div>

          <div className="login-brand__text">
            <h1>EduControl Pro</h1>
            <p>TA’LIM BOSHQARUV TIZIMI</p>
          </div>
        </header>

        <div className="login-heading">
          <h2 id="login-title">Xush kelibsiz</h2>
          <p>Boshqaruv paneliga kirish uchun ma’lumotlaringizni kiriting.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate aria-busy={loading}>
          <div className="login-field">
            <label htmlFor="username">Login</label>

            <div className="login-input">
              <UserRound
                size={18}
                className="login-input__icon"
                aria-hidden="true"
              />

              <input
                id="username"
                name="username"
                type="text"
                placeholder="Loginingizni kiriting"
                autoComplete="username"
                spellCheck="false"
                autoCapitalize="none"
                maxLength={80}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                value={username}
                onChange={handleUsernameChange}
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">Parol</label>

            <div className="login-input">
              <LockKeyhole
                size={18}
                className="login-input__icon"
                aria-hidden="true"
              />

              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Parolni kiriting"
                autoComplete="current-password"
                maxLength={256}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                value={password}
                onChange={handlePasswordChange}
                disabled={loading}
              />

              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={
                  showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'
                }
                aria-pressed={showPassword}
                title={
                  showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'
                }
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <p id="login-error" className="login-message" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2
                  size={18}
                  className="login-submit__spinner"
                  aria-hidden="true"
                />
                <span>Tekshirilmoqda...</span>
              </>
            ) : (
              <>
                <span>Tizimga kirish</span>
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <footer className="login-footer">
          <span className="login-footer__dot" aria-hidden="true" />
          <p>Xavfsiz ulanish · EduControl Pro © {currentYear}</p>
        </footer>
      </section>
    </main>
  )
}

export default Login
