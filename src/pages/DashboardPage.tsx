import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  createOrganization,
  deleteProject,
  createProjectFromPreset,
  fetchOrganizations,
  fetchPresets,
  fetchProjectSummaries,
  updateProjectStatus,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { projectStatusLabelMap } from '../lib/project-status'
import type {
  ContractorPreset,
  Organization,
  ProjectStatus,
  ProjectSummary,
} from '../lib/models'
import { projectGroups } from '../lib/models'
import { useAuth } from '../hooks/useAuth'
import { StatusBadge } from '../components/StatusBadge'

const emptyProjectForm = {
  name: '',
  customerName: '',
  location: '',
  bidDueDate: '',
  notes: '',
}

const projectStatusOptions: ProjectStatus[] = [
  'draft',
  'bidding',
  'submitted',
  'won',
  'active',
  'completed',
  'lost',
]

export const DashboardPage = () => {
  const navigate = useNavigate()
  const { signOutUser, user } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [presets, setPresets] = useState<ContractorPreset[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProjectsLoading, setIsProjectsLoading] = useState(true)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [projectForm, setProjectForm] = useState(emptyProjectForm)
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false)
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false)
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null)
  const [actionMenuProjectId, setActionMenuProjectId] = useState<string | null>(null)
  const [actioningProjectId, setActioningProjectId] = useState<string | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)

  const loadOrganizations = useCallback(async () => {
    if (!user) {
      return
    }

    setIsLoading(true)
    setScreenError(null)

    try {
      const nextOrganizations = await fetchOrganizations()
      setOrganizations(nextOrganizations)
      setSelectedOrganizationId((current) => current ?? nextOrganizations[0]?.id ?? null)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Failed to load dashboard'
      setScreenError(message)
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadOrganizations()
  }, [loadOrganizations])

  useEffect(() => {
    if (!actionMenuProjectId) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setActionMenuProjectId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [actionMenuProjectId])

  useEffect(() => {
    const loadScopedData = async () => {
      if (!selectedOrganizationId) {
        setProjects([])
        setPresets([])
        setIsProjectsLoading(false)
        return
      }

      setIsProjectsLoading(true)

      try {
        const [nextPresets, nextProjects] = await Promise.all([
          fetchPresets(),
          fetchProjectSummaries(selectedOrganizationId),
        ])

        setPresets(nextPresets)
        setSelectedPresetId((current) => current || nextPresets[0]?.id || '')
        setProjects(nextProjects)
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : 'Failed to load projects'
        setScreenError(message)
      } finally {
        setIsProjectsLoading(false)
      }
    }

    void loadScopedData()
  }, [selectedOrganizationId])

  const groupedProjects = useMemo(
    () =>
      projectGroups.map((group) => ({
        ...group,
        projects: projects.filter(
          (project) => project.status && group.statuses.includes(project.status),
        ),
      })),
    [projects],
  )

  const handleCreateOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsCreatingOrganization(true)
    setScreenError(null)

    try {
      await createOrganization(organizationName, organizationSlug || undefined)
      setOrganizationName('')
      setOrganizationSlug('')
      await loadOrganizations()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to create organization'
      setScreenError(message)
    } finally {
      setIsCreatingOrganization(false)
    }
  }

  const handleCreateProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedOrganizationId || !selectedPresetId) {
      setScreenError('Select an organization and preset first.')
      return
    }

    setIsCreatingProject(true)
    setScreenError(null)

    try {
      const projectId = await createProjectFromPreset({
        organizationId: selectedOrganizationId,
        presetId: selectedPresetId,
        ...projectForm,
      })

      setProjectForm(emptyProjectForm)
      setIsCreateFormOpen(false)
      navigate(`/projects/${projectId}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to create project'
      setScreenError(message)
    } finally {
      setIsCreatingProject(false)
    }
  }

  const handleProjectStatusChange = async (projectId: string, status: ProjectStatus) => {
    const previousProjects = projects
    setUpdatingProjectId(projectId)
    setScreenError(null)
    setProjects((current) =>
      current.map((project) =>
        project.project_id === projectId ? { ...project, status } : project,
      ),
    )

    try {
      await updateProjectStatus(projectId, status)
    } catch (caughtError) {
      setProjects(previousProjects)
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to update project status'
      setScreenError(message)
    } finally {
      setUpdatingProjectId(null)
    }
  }

  const handleArchiveProject = async (projectId: string) => {
    setActionMenuProjectId(null)
    await handleProjectStatusChange(projectId, 'archived')
  }

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm('Delete this job and all of its data?')) {
      return
    }

    const previousProjects = projects
    setActionMenuProjectId(null)
    setActioningProjectId(projectId)
    setScreenError(null)
    setProjects((current) => current.filter((project) => project.project_id !== projectId))

    try {
      await deleteProject(projectId)
    } catch (caughtError) {
      setProjects(previousProjects)
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to delete project'
      setScreenError(message)
    } finally {
      setActioningProjectId(null)
    }
  }

  return (
    <main className="app-screen app-screen-compact">
      <header className="topbar topbar-simple">
        <div className="topbar-heading">
          <h1>Projects</h1>
          <p className="topbar-subtitle">Simple bid and job tracking workspace.</p>
        </div>
        <div className="topbar-actions">
          {organizations.length > 0 ? (
            <button
              className="secondary-button"
              onClick={() => setIsCreateFormOpen((current) => !current)}
              type="button"
            >
              {isCreateFormOpen ? 'Close' : 'New bid'}
            </button>
          ) : null}
          <button className="secondary-button" onClick={() => void signOutUser()} type="button">
            Sign out
          </button>
        </div>
      </header>

      {screenError ? <p className="screen-error">{screenError}</p> : null}

      {isLoading ? (
        <article className="panel">
          <div className="panel-empty">Loading projects…</div>
        </article>
      ) : organizations.length === 0 ? (
        <article className="panel panel-compact">
          <form className="stack-form" onSubmit={handleCreateOrganization}>
            <label>
              Organization name
              <input
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                type="text"
                value={organizationName}
              />
            </label>
            <label>
              Slug (optional)
              <input
                onChange={(event) => setOrganizationSlug(event.target.value)}
                type="text"
                value={organizationSlug}
              />
            </label>
            <button className="primary-button" disabled={isCreatingOrganization} type="submit">
              {isCreatingOrganization ? 'Creating…' : 'Create organization'}
            </button>
          </form>
        </article>
      ) : (
        <>
          {isCreateFormOpen ? (
              <article className="panel panel-compact">
               <form className="stack-form stack-form-inline project-create-form" onSubmit={handleCreateProject}>
                 <label className="project-create-field">
                   Preset
                   <select
                     className="project-create-select"
                     disabled={isProjectsLoading || presets.length === 0}
                     onChange={(event) => setSelectedPresetId(event.target.value)}
                     value={selectedPresetId}
                  >
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                 <label className="project-create-field">
                   Project name
                   <input
                    onChange={(event) =>
                      setProjectForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                    type="text"
                    value={projectForm.name}
                  />
                </label>
                 <label className="project-create-field">
                   Customer
                  <input
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        customerName: event.target.value,
                      }))
                    }
                    type="text"
                    value={projectForm.customerName}
                  />
                </label>
                 <label className="project-create-field">
                   Location
                  <input
                    onChange={(event) =>
                      setProjectForm((current) => ({ ...current, location: event.target.value }))
                    }
                    type="text"
                    value={projectForm.location}
                  />
                </label>
                 <label className="project-create-field">
                   Due date
                  <input
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        bidDueDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={projectForm.bidDueDate}
                  />
                </label>
                 <button
                   className="primary-button project-create-submit"
                   disabled={
                     isCreatingProject ||
                    isProjectsLoading ||
                    !selectedOrganizationId ||
                    !selectedPresetId
                  }
                  type="submit"
                >
                  {isCreatingProject ? 'Creating…' : 'Create bid'}
                </button>
              </form>
            </article>
          ) : null}

          <section className="list-stack">
            {groupedProjects.map((group) => (
              <article className="panel panel-table" key={group.label}>
                <div className="panel-heading panel-heading-compact">
                  <div>
                    <h2>{group.label}</h2>
                  </div>
                  <span className="section-count">
                    {isProjectsLoading ? '—' : group.projects.length}
                  </span>
                </div>

                {isProjectsLoading ? (
                  <div className="panel-empty">Loading projects…</div>
                ) : group.projects.length === 0 ? (
                  <div className="panel-empty">No projects yet.</div>
                ) : (
                  <>
                    <div className="project-list-shell dashboard-project-table">
                    <table className="project-list-table">
                      <colgroup>
                        <col className="project-list-col-project" />
                        <col className="project-list-col-customer" />
                       <col className="project-list-col-due" />
                        <col className="project-list-col-status" />
                        <col className="project-list-col-total" />
                        <col className="project-list-col-actions" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Customer</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>Total</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.projects.map((project) => (
                          <tr key={project.project_id ?? project.name}>
                            <td className="project-list-primary">
                              <Link className="project-list-link" to={`/projects/${project.project_id}`}>
                                {project.name ?? 'Untitled project'}
                              </Link>
                              <span className="project-list-subtext">
                                {project.location ?? 'Location pending'}
                              </span>
                            </td>
                            <td>{project.customer_name ?? '—'}</td>
                            <td>{formatDate(project.bid_due_date)}</td>
                            <td className="project-list-status">
                              {project.project_id ? (
                                <select
                                  aria-label={`Status for ${project.name ?? 'project'}`}
                                  className={`status-select status-select-${project.status ?? 'draft'}`}
                                  disabled={updatingProjectId === project.project_id}
                                  onChange={(event) => {
                                    void handleProjectStatusChange(
                                      project.project_id ?? '',
                                      event.target.value as ProjectStatus,
                                    )
                                  }}
                                  value={project.status ?? 'draft'}
                                >
                                  {projectStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                      {projectStatusLabelMap[status]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                project.status ? <StatusBadge status={project.status} /> : '—'
                              )}
                            </td>
                             <td className="project-list-amount">
                               <strong>{formatCurrency(project.estimated_total_cost)}</strong>
                               {project.status === 'active' ? (
                                 <span>{formatCurrency(project.actual_total_cost)} actual</span>
                               ) : null}
                             </td>
                             <td className="project-list-actions-cell">
                               {project.project_id ? (
                                 <div
                                   className="project-row-actions"
                                   ref={
                                     actionMenuProjectId === project.project_id ? actionMenuRef : undefined
                                   }
                                 >
                                   <button
                                     aria-expanded={actionMenuProjectId === project.project_id}
                                     aria-label={`Actions for ${project.name ?? 'project'}`}
                                     className="project-row-actions-button"
                                     disabled={actioningProjectId === project.project_id}
                                     onClick={() =>
                                       setActionMenuProjectId((current) =>
                                         current === project.project_id ? null : project.project_id,
                                       )
                                     }
                                     type="button"
                                   >
                                     •••
                                   </button>
                                   {actionMenuProjectId === project.project_id ? (
                                     <div className="project-row-actions-menu">
                                       {project.status !== 'archived' ? (
                                         <button
                                           className="project-row-actions-item"
                                           disabled={actioningProjectId === project.project_id}
                                           onClick={() => {
                                             void handleArchiveProject(project.project_id ?? '')
                                           }}
                                           type="button"
                                         >
                                           Archive
                                         </button>
                                       ) : null}
                                       <button
                                         className="project-row-actions-item project-row-actions-item-danger"
                                         disabled={actioningProjectId === project.project_id}
                                         onClick={() => {
                                           void handleDeleteProject(project.project_id ?? '')
                                         }}
                                         type="button"
                                       >
                                         Delete job
                                       </button>
                                     </div>
                                   ) : null}
                                 </div>
                               ) : null}
                             </td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <div className="dashboard-mobile-list">
                      {group.projects.map((project) => (
                        <article className="dashboard-mobile-card" key={`mobile-${project.project_id ?? project.name}`}>
                          <div className="dashboard-mobile-card-header">
                            <div className="dashboard-mobile-card-copy">
                              {project.project_id ? (
                                <Link
                                  className="dashboard-mobile-card-link"
                                  to={`/projects/${project.project_id}`}
                                >
                                  {project.name ?? 'Untitled project'}
                                </Link>
                              ) : (
                                <span className="dashboard-mobile-card-link">
                                  {project.name ?? 'Untitled project'}
                                </span>
                              )}
                              <p>{project.customer_name ?? 'Customer pending'}</p>
                              <p>{project.location ?? 'Location pending'}</p>
                            </div>
                            <div className="dashboard-mobile-card-amount">
                              <strong>{formatCurrency(project.estimated_total_cost)}</strong>
                              <span>Due {formatDate(project.bid_due_date)}</span>
                            </div>
                          </div>
                          <div className="dashboard-mobile-card-meta">
                            {project.status ? <StatusBadge status={project.status} /> : null}
                            {project.status === 'active' ? (
                              <span className="dashboard-mobile-chip">
                                {formatCurrency(project.actual_total_cost)} actual
                              </span>
                            ) : null}
                          </div>
                          <div className="dashboard-mobile-card-controls">
                            <div className="dashboard-mobile-card-status">
                              {project.project_id ? (
                                <select
                                  aria-label={`Status for ${project.name ?? 'project'}`}
                                  className={`status-select status-select-${project.status ?? 'draft'}`}
                                  disabled={updatingProjectId === project.project_id}
                                  onChange={(event) => {
                                    void handleProjectStatusChange(
                                      project.project_id ?? '',
                                      event.target.value as ProjectStatus,
                                    )
                                  }}
                                  value={project.status ?? 'draft'}
                                >
                                  {projectStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                      {projectStatusLabelMap[status]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                project.status ? <StatusBadge status={project.status} /> : '—'
                              )}
                            </div>
                            {project.project_id ? (
                              <div
                                className="project-row-actions dashboard-mobile-card-actions"
                                ref={
                                  actionMenuProjectId === project.project_id ? actionMenuRef : undefined
                                }
                              >
                                <button
                                  aria-expanded={actionMenuProjectId === project.project_id}
                                  aria-label={`Actions for ${project.name ?? 'project'}`}
                                  className="project-row-actions-button"
                                  disabled={actioningProjectId === project.project_id}
                                  onClick={() =>
                                    setActionMenuProjectId((current) =>
                                      current === project.project_id ? null : project.project_id,
                                    )
                                  }
                                  type="button"
                                >
                                  •••
                                </button>
                                {actionMenuProjectId === project.project_id ? (
                                  <div className="project-row-actions-menu">
                                    {project.status !== 'archived' ? (
                                      <button
                                        className="project-row-actions-item"
                                        disabled={actioningProjectId === project.project_id}
                                        onClick={() => {
                                          void handleArchiveProject(project.project_id ?? '')
                                        }}
                                        type="button"
                                      >
                                        Archive
                                      </button>
                                    ) : null}
                                    <button
                                      className="project-row-actions-item project-row-actions-item-danger"
                                      disabled={actioningProjectId === project.project_id}
                                      onClick={() => {
                                        void handleDeleteProject(project.project_id ?? '')
                                      }}
                                      type="button"
                                    >
                                      Delete job
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  )
}
