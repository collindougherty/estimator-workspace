import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { env } from '../lib/env'
import { useAuth } from '../hooks/useAuth'

export const LoginPage = () => {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState(env.demoEmail)
  const [password, setPassword] = useState(env.demoPassword)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to sign in'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card-simple">
        <form className="auth-form" onSubmit={handleSubmit}>
          <p className="eyebrow">Estimator workspace</p>
          <h1>Sign in</h1>
          <div>
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
