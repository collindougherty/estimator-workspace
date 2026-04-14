import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { MetricCard } from '../components/MetricCard'
import { StatusBadge } from '../components/StatusBadge'
import {
  fetchOrganizations,
  fetchProjectItemMetrics,
  fetchProjectSummary,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { exportProposalPdf } from '../lib/proposal-pdf'
import type { ProjectItemMetric, ProjectSummary } from '../lib/models'

type SectionGroup = {
  key: string
  sectionCode: string
  sectionName: string
  items: ProjectItemMetric[]
  estimatedTotal: number
  actualTotal: number
}

const filterTerminalItems = (items: ProjectItemMetric[]) => {
  const codes = items
    .map((item) => item.item_code?.trim())
    .filter((code): code is string => Boolean(code))

  return items.filter((item) => {
    const code = item.item_code?.trim()

    if (!code) {
      return true
    }

    return !codes.some((candidate) => candidate !== code && candidate.startsWith(`${code}.`))
  })
}

const buildSectionGroups = (items: ProjectItemMetric[]) => {
  const groups = new Map<string, SectionGroup>()

  for (const item of items) {
    const sectionCode = item.section_code ?? '—'
    const sectionName = item.section_name ?? 'Unassigned scope'
    const key = `${sectionCode}:${sectionName}`
    const existingGroup = groups.get(key)

    if (!existingGroup) {
      groups.set(key, {
        key,
        sectionCode,
        sectionName,
        items: [item],
        estimatedTotal: item.estimated_total_cost ?? 0,
        actualTotal: item.actual_total_cost ?? 0,
      })
      continue
    }

    existingGroup.items.push(item)
    existingGroup.estimatedTotal += item.estimated_total_cost ?? 0
    existingGroup.actualTotal += item.actual_total_cost ?? 0
  }

  return Array.from(groups.values())
}

export const ProjectPage = () => {
  const { projectId } = useParams()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [items, setItems] = useState<ProjectItemMetric[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [screenError, setScreenError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadProject = useCallback(async () => {
    if (!projectId) {
      return
    }

    setIsLoading(true)
    setScreenError(null)

    try {
      const [nextProject, nextItems, organizations] = await Promise.all([
        fetchProjectSummary(projectId),
        fetchProjectItemMetrics(projectId),
        fetchOrganizations(),
      ])

      setProject(nextProject)
      setItems(nextItems)
      setOrganizationName(
        organizations.find((organization) => organization.id === nextProject?.organization_id)
          ?.name ??
          organizations[0]?.name ??
          '',
      )
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to load project'
      setScreenError(message)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  const projectMode = useMemo(() => {
    if (!project?.status) {
      return 'estimate'
    }

    if (project.status === 'active' || project.status === 'completed') {
      return 'tracking'
    }

    if (project.status === 'lost' || project.status === 'archived') {
      return 'closed-estimate'
    }

    return 'estimate'
  }, [project?.status])

  const terminalItems = useMemo(() => filterTerminalItems(items), [items])
  const sectionGroups = useMemo(() => buildSectionGroups(terminalItems), [terminalItems])
  const projectProfit = (project?.estimated_total_cost ?? 0) - (project?.actual_total_cost ?? 0)

  if (!projectId) {
    return <Navigate replace to="/" />
  }

  const handleExportProposal = () => {
    if (!project) {
      return
    }

    exportProposalPdf({
      organizationName,
      project,
      items,
    })
  }

  return (
    <main className="app-screen app-screen-compact">
      <header className="project-header project-header-simple">
        <div className="project-header-copy">
          <Link className="back-link" to="/">
            ← Back
          </Link>
          <h1>{project?.name ?? (isLoading ? 'Loading project…' : 'Project not found')}</h1>
          <p className="project-meta-line">
            <span>{project?.customer_name ?? 'Customer pending'}</span>
            <span>{project?.location ?? 'Location pending'}</span>
            <span>Due {project ? formatDate(project.bid_due_date) : isLoading ? 'Loading…' : 'No date'}</span>
          </p>
        </div>
        <div className="project-header-actions">
          <button
            className="secondary-button"
            disabled={isLoading || !project || items.every((item) => !item.is_included)}
            onClick={handleExportProposal}
            type="button"
          >
            Export proposal
          </button>
          {project?.status ? <StatusBadge status={project.status} /> : null}
        </div>
      </header>

      {screenError ? <p className="screen-error">{screenError}</p> : null}

      <section className="metrics-grid">
        <MetricCard
          label={projectMode === 'tracking' ? 'Bid' : 'Estimate'}
          value={project ? formatCurrency(project.estimated_total_cost) : '—'}
        />
        <MetricCard
          label="Actual"
          value={project ? formatCurrency(project.actual_total_cost) : '—'}
        />
        <MetricCard
          label={projectMode === 'tracking' ? 'Profit' : 'Invoice'}
          note={
            projectMode === 'tracking' && project
              ? `Invoice ${formatCurrency(project.invoice_amount)}`
              : undefined
          }
          value={
            project
              ? formatCurrency(
                  projectMode === 'tracking' ? projectProfit : project.invoice_amount,
                )
              : '—'
          }
        />
      </section>

      <article className="panel panel-large">
        <div className="panel-heading panel-heading-compact">
          <div>
            <h2>Terminal items</h2>
            <p className="panel-meta">
              {projectMode === 'tracking'
                ? 'Open a terminal WBS item to enter actual quantities, labor, equipment, and billing details.'
                : 'Open a terminal WBS item to enter quantity, labor, equipment, and pricing without cluttering the project page.'}
            </p>
          </div>
          <span className="section-count">{isLoading ? '—' : terminalItems.length}</span>
        </div>

        {isLoading ? (
          <div className="panel-empty">Loading terminal items…</div>
        ) : sectionGroups.length === 0 ? (
          <div className="panel-empty">No terminal items yet.</div>
        ) : (
          <div className="project-item-list-stack">
            {sectionGroups.map((section) => (
              <section className="project-item-section" key={section.key}>
                <div className="project-item-section-header">
                  <div>
                    <span className="eyebrow">{section.sectionCode}</span>
                    <h3>{section.sectionName}</h3>
                  </div>
                  <div className="project-item-section-summary">
                    <strong>
                      {formatCurrency(
                        projectMode === 'tracking' ? section.actualTotal : section.estimatedTotal,
                      )}
                    </strong>
                    <span>
                      {projectMode === 'tracking'
                        ? `Bid ${formatCurrency(section.estimatedTotal)}`
                        : `${section.items.length} items`}
                    </span>
                  </div>
                </div>

                <div className="project-item-card-list">
                  {section.items.map((item) => (
                    <Link
                      className="project-item-card"
                      key={item.project_estimate_item_id}
                      to={`/projects/${projectId}/items/${item.project_estimate_item_id}`}
                    >
                      <div className="project-item-card-copy">
                        <div className="project-item-card-tags">
                          <span className="scope-code-pill mono">{item.item_code}</span>
                          <span className="scope-unit-pill">{item.unit}</span>
                          {!item.is_included ? <span className="worksheet-mobile-flag">Excluded</span> : null}
                        </div>
                        <strong>{item.item_name ?? 'Scope item'}</strong>
                        <span className="project-item-card-note">
                          {projectMode === 'tracking'
                            ? 'Open item to enter actual quantities, labor, equipment, and billing.'
                            : 'Open item to enter quantity, labor, equipment, and price details.'}
                        </span>
                      </div>
                      <div className="project-item-card-summary">
                        <span>{projectMode === 'tracking' ? 'Actual' : 'Estimate'}</span>
                        <strong>
                          {formatCurrency(
                            projectMode === 'tracking'
                              ? item.actual_total_cost
                              : item.estimated_total_cost,
                          )}
                        </strong>
                        <small>
                          {projectMode === 'tracking'
                            ? `Bid ${formatCurrency(item.estimated_total_cost)}`
                            : `${item.quantity ?? 0} ${item.unit ?? ''}`.trim()}
                        </small>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </article>
    </main>
  )
}
