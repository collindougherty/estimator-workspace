import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  createOrganization,
  duplicateProject,
  deleteProject,
  createProjectFromPreset,
  fetchOrganizations,
  fetchPresets,
  fetchPresetWbsItems,
  fetchProjectSummaries,
  updateProjectStatus,
} from '../lib/api'
import { WorkspaceMenu } from '../components/WorkspaceMenu'
import { formatCurrency, formatDate } from '../lib/formatters'
import {
  normalizeProjectStatus,
  projectStatusLabelMap,
  visibleProjectStatusOptions,
} from '../lib/project-status'
import type {
  ContractorPreset,
  Organization,
  PresetWbsItem,
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

export const DashboardPage = () => {
  const navigate = useNavigate()
  const { signOutUser, user } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [presets, setPresets] = useState<ContractorPreset[]>([])
  const [presetScopeItems, setPresetScopeItems] = useState<PresetWbsItem[]>([])
  const [selectedPresetScopeIds, setSelectedPresetScopeIds] = useState<string[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProjectsLoading, setIsProjectsLoading] = useState(true)
  const [isPresetScopesLoading, setIsPresetScopesLoading] = useState(false)
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

  useEffect(() => {
    const loadPresetScopeItems = async () => {
      if (!selectedPresetId) {
        setPresetScopeItems([])
        setSelectedPresetScopeIds([])
        return
      }

      setIsPresetScopesLoading(true)

      try {
        const nextPresetScopeItems = await fetchPresetWbsItems(selectedPresetId)
        const defaultSelectedScopeIds = nextPresetScopeItems
          .filter((item) => item.active_default)
          .map((item) => item.id)

        setPresetScopeItems(nextPresetScopeItems)
        setSelectedPresetScopeIds(
          defaultSelectedScopeIds.length > 0
            ? defaultSelectedScopeIds
            : nextPresetScopeItems.map((item) => item.id),
        )
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : 'Failed to load preset scopes'
        setScreenError(message)
      } finally {
        setIsPresetScopesLoading(false)
      }
    }

    void loadPresetScopeItems()
  }, [selectedPresetId])

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

  const presetScopeSections = useMemo(() => {
    const sections = new Map<
      string,
      {
        itemCount: number
        items: PresetWbsItem[]
        label: string
      }
    >()

    presetScopeItems.forEach((item) => {
      const key = `${item.section_code}-${item.section_name}`
      const section = sections.get(key)

      if (section) {
        section.items.push(item)
        section.itemCount += 1
        return
      }

      sections.set(key, {
        itemCount: 1,
        items: [item],
        label: `${item.section_code} · ${item.section_name}`,
      })
    })

    return Array.from(sections.values())
  }, [presetScopeItems])

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

    if (selectedPresetScopeIds.length === 0) {
      setScreenError('Select at least one scope for the new bid.')
      return
    }

    setIsCreatingProject(true)
    setScreenError(null)

    try {
      const projectId = await createProjectFromPreset({
        organizationId: selectedOrganizationId,
        presetId: selectedPresetId,
        presetItemIds: selectedPresetScopeIds,
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

  const handleTogglePresetScope = (scopeItemId: string) => {
    setSelectedPresetScopeIds((current) =>
      current.includes(scopeItemId)
        ? current.filter((itemId) => itemId !== scopeItemId)
        : [...current, scopeItemId],
    )
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

  const handleDuplicateProject = async (project: ProjectSummary) => {
    if (!project.project_id) {
      return
    }

    setActionMenuProjectId(null)
    setActioningProjectId(project.project_id)
    setScreenError(null)

    try {
      const duplicatedProjectId = await duplicateProject(project.project_id)
      navigate(`/projects/${duplicatedProjectId}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to duplicate project'
      setScreenError(message)
    } finally {
      setActioningProjectId(null)
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
        <div className="app-brand-lockup">
          <div aria-hidden="true" className="app-brand-mark">
            PB
          </div>
          <h1>ProfitBuilder</h1>
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
          <WorkspaceMenu />
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
                 <div className="project-create-scope-panel">
                   <div className="project-create-scope-header">
                     <div>
                       <span className="eyebrow">Scopes</span>
                       <strong>Pick what to start with</strong>
                       <p className="panel-meta">
                         Check the preset scopes you want cloned into this bid.
                       </p>
                     </div>
                     <span className="section-count">
                       {isPresetScopesLoading ? '—' : selectedPresetScopeIds.length}
                     </span>
                   </div>

                   {isPresetScopesLoading ? (
                     <div className="panel-empty">Loading preset scopes…</div>
                   ) : (
                     <div className="project-create-scope-groups">
                       {presetScopeSections.map((section) => (
                         <section className="project-create-scope-group" key={section.label}>
                           <div className="project-create-scope-group-heading">
                             <strong>{section.label}</strong>
                             <span>{section.itemCount} scopes</span>
                           </div>
                           <div className="project-create-scope-options">
                             {section.items.map((item) => {
                               const isChecked = selectedPresetScopeIds.includes(item.id)

                               return (
                                 <label className="project-create-scope-option" key={item.id}>
                                   <input
                                     checked={isChecked}
                                     onChange={() => handleTogglePresetScope(item.id)}
                                     type="checkbox"
                                   />
                                   <div>
                                     <strong>{item.item_name}</strong>
                                     <span>
                                       {item.item_code} · {item.unit}
                                     </span>
                                   </div>
                                 </label>
                               )
                             })}
                           </div>
                         </section>
                       ))}
                     </div>
                   )}
                 </div>
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
                                  className={`status-select status-select-${normalizeProjectStatus(project.status)}`}
                                  disabled={updatingProjectId === project.project_id}
                                  onChange={(event) => {
                                    void handleProjectStatusChange(
                                      project.project_id ?? '',
                                      event.target.value as ProjectStatus,
                                    )
                                  }}
                                  value={normalizeProjectStatus(project.status)}
                                >
                                  {visibleProjectStatusOptions.map((status) => (
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
                                        <button
                                          className="project-row-actions-item"
                                          disabled={actioningProjectId === project.project_id}
                                          onClick={() => {
                                            void handleDuplicateProject(project)
                                          }}
                                          type="button"
                                        >
                                          Duplicate
                                        </button>
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
                                  className={`status-select status-select-${normalizeProjectStatus(project.status)}`}
                                  disabled={updatingProjectId === project.project_id}
                                  onChange={(event) => {
                                    void handleProjectStatusChange(
                                      project.project_id ?? '',
                                      event.target.value as ProjectStatus,
                                    )
                                  }}
                                  value={normalizeProjectStatus(project.status)}
                                >
                                  {visibleProjectStatusOptions.map((status) => (
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
                                     <button
                                       className="project-row-actions-item"
                                       disabled={actioningProjectId === project.project_id}
                                       onClick={() => {
                                         void handleDuplicateProject(project)
                                       }}
                                       type="button"
                                     >
                                       Duplicate
                                     </button>
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
