import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import './App.css'
import { AuthProvider } from './hooks/AuthProvider'
import { useAuth } from './hooks/useAuth'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { ProjectItemPage } from './pages/ProjectItemPage'
import { ProjectPage } from './pages/ProjectPage'

const AppRouter = () => {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <main className="loading-screen">
        <div className="loading-card">
          <p className="eyebrow">Estimator workspace</p>
          <h1>Loading workspace…</h1>
          <p>Preparing workspace.</p>
        </div>
      </main>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate replace to="/" /> : <LoginPage />}
      />
      <Route
        path="/"
        element={user ? <DashboardPage /> : <Navigate replace to="/login" />}
      />
      <Route
        path="/projects/:projectId"
        element={user ? <ProjectPage /> : <Navigate replace to="/login" />}
      />
      <Route
        path="/projects/:projectId/items/:itemId"
        element={user ? <ProjectItemPage /> : <Navigate replace to="/login" />}
      />
      <Route path="*" element={<Navigate replace to={user ? '/' : '/login'} />} />
    </Routes>
  )
}

function App() {
  const Router = import.meta.env.VITE_USE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter

  return (
    <AuthProvider>
      <Router>
        <AppRouter />
      </Router>
    </AuthProvider>
  )
}

export default App
