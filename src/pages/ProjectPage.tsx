import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { CompanyLibraryPanel } from '../components/CompanyLibraryPanel'
import { FloatingPanel } from '../components/FloatingPanel'
import { MetricCard } from '../components/MetricCard'
import { ProjectEstimateBuilder } from '../components/ProjectEstimateBuilder'
import { StatusBadge } from '../components/StatusBadge'
import {
  createOrganizationEmployeeLibraryItem,
  createOrganizationEquipmentLibraryItem,
  createOrganizationMaterialLibraryItem,
  deleteOrganizationEmployeeLibraryItem,
  deleteOrganizationEquipmentLibraryItem,
  deleteOrganizationMaterialLibraryItem,
  fetchOrganizationEmployeeLibrary,
  fetchOrganizationEquipmentLibrary,
  fetchOrganizationMaterialLibrary,
  fetchOrganizations,
  fetchProjectItemMetrics,
  fetchProjectSummary,
  updateProjectEstimateItem,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { exportProposalPdf } from '../lib/proposal-pdf'
import { applyEstimatePatchToProjectItemMetric } from '../lib/project-estimate-builder'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectEstimateItemUpdate,
  ProjectItemMetric,
  ProjectSummary,
} from '../lib/models'

type SectionGroup = {
  actualTotal: number
  estimatedTotal: number
  items: ProjectItemMetric[]
  key: string
  sectionCode: string
  sectionName: string
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

    return !codes.some((candidate) => candidate !== code && candidate.startsWith(code + '.'))
  })
}

const buildSectionGroups = (items: ProjectItemMetric[]) => {
  const groups = new Map<string, SectionGroup>()

  for (const item of items) {
    const sectionCode = item.section_code ?? '—'
    const sectionName = item.section_name ?? 'Unassigned scope'
    const key = sectionCode + ':' + sectionName
    const existingGroup = groups.get(key)

    if (!existingGroup) {
      groups.set(key, {
        actualTotal: item.actual_total_cost ?? 0,
        estimatedTotal: item.estimated_total_cost ?? 0,
        items: [item],
        key,
        sectionCode,
        sectionName,
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
  const [employeeLibrary, setEmployeeLibrary] = useState<OrganizationEmployeeLibraryItem[]>([])
  const [equipmentLibrary, setEquipmentLibrary] = useState<OrganizationEquipmentLibraryItem[]>([])
  const [materialLibrary, setMaterialLibrary] = useState<OrganizationMaterialLibraryItem[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [isCompanyLibraryOpen, setIsCompanyLibraryOpen] = useState(false)
  const [isLibrarySaving, setIsLibrarySaving] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadCompanyLibraries = useCallback(async (organizationId: string) => {
    const [nextEmployees, nextEquipment, nextMaterials] = await Promise.all([
      fetchOrganizationEmployeeLibrary(organizationId),
      fetchOrganizationEquipmentLibrary(organizationId),
      fetchOrganizationMaterialLibrary(organizationId),
    ])

    setEmployeeLibrary(nextEmployees)
    setEquipmentLibrary(nextEquipment)
    setMaterialLibrary(nextMaterials)
  }, [])

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

      if (nextProject?.organization_id) {
        await loadCompanyLibraries(nextProject.organization_id)
      } else {
        setEmployeeLibrary([])
        setEquipmentLibrary([])
        setMaterialLibrary([])
      }

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
  }, [loadCompanyLibraries, projectId])

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
  const showEstimateBuilder = projectMode !== 'tracking'
  const estimateSummary = useMemo(
    () =>
      terminalItems.reduce(
        (summary, item) => {
          if (!item.is_included) {
            summary.itemCount += 1
            return summary
          }

          summary.itemCount += 1
          summary.includedCount += 1
          summary.includedTotal += item.estimated_total_cost ?? 0
          summary.directCost +=
            (item.estimated_labor_cost ?? 0) +
            (item.material_cost ?? 0) +
            (item.estimated_equipment_cost ?? 0) +
            (item.subcontract_cost ?? 0)
          summary.markup +=
            (item.estimated_overhead_cost ?? 0) + (item.estimated_profit_cost ?? 0)
          return summary
        },
        {
          directCost: 0,
          includedCount: 0,
          includedTotal: 0,
          itemCount: 0,
          markup: 0,
        },
      ),
    [terminalItems],
  )

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

  const getProjectOrganizationId = () => {
    if (!project?.organization_id) {
      throw new Error('Project organization is unavailable')
    }

    return project.organization_id
  }

  const runCompanyLibraryMutation = async (mutation: (organizationId: string) => Promise<void>) => {
    setIsLibrarySaving(true)
    setScreenError(null)

    try {
      const organizationId = getProjectOrganizationId()
      await mutation(organizationId)
      await loadCompanyLibraries(organizationId)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to update company library'
      setScreenError(message)
      throw caughtError
    } finally {
      setIsLibrarySaving(false)
    }
  }

  const handleCreateEmployeeLibraryItem = async (draft: {
    hourlyRate: number
    name: string
    role: string
  }) => {
    await runCompanyLibraryMutation(async (organizationId) => {
      await createOrganizationEmployeeLibraryItem({
        organization_id: organizationId,
        name: draft.name,
        role: draft.role || null,
        hourly_rate: draft.hourlyRate,
      })
    })
  }

  const handleDeleteEmployeeLibraryItem = async (itemIdToDelete: string) => {
    await runCompanyLibraryMutation(async () => {
      await deleteOrganizationEmployeeLibraryItem(itemIdToDelete)
    })
  }

  const handleCreateEquipmentLibraryItem = async (draft: { dailyRate: number; name: string }) => {
    await runCompanyLibraryMutation(async (organizationId) => {
      await createOrganizationEquipmentLibraryItem({
        organization_id: organizationId,
        name: draft.name,
        daily_rate: draft.dailyRate,
      })
    })
  }

  const handleDeleteEquipmentLibraryItem = async (itemIdToDelete: string) => {
    await runCompanyLibraryMutation(async () => {
      await deleteOrganizationEquipmentLibraryItem(itemIdToDelete)
    })
  }

  const handleCreateMaterialLibraryItem = async (draft: {
    costPerUnit: number
    name: string
    unit: string
  }) => {
    await runCompanyLibraryMutation(async (organizationId) => {
      await createOrganizationMaterialLibraryItem({
        organization_id: organizationId,
        name: draft.name,
        unit: draft.unit,
        cost_per_unit: draft.costPerUnit,
      })
    })
  }

  const handleDeleteMaterialLibraryItem = async (itemIdToDelete: string) => {
    await runCompanyLibraryMutation(async () => {
      await deleteOrganizationMaterialLibraryItem(itemIdToDelete)
    })
  }

  const handleSaveEstimateRow = async (
    itemId: string,
    patch: ProjectEstimateItemUpdate,
  ) => {
    setScreenError(null)

    try {
      await updateProjectEstimateItem(itemId, patch)
      setItems((current) =>
        current.map((item) =>
          item.project_estimate_item_id === itemId
            ? applyEstimatePatchToProjectItemMetric(item, patch)
            : item,
        ),
      )
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save scope item'
      setScreenError(message)
      throw caughtError
    }
  }

  return (
    <main className="app-screen app-screen-compact">
      <header className="project-header project-header-simple">
        <div className="project-header-copy">
          <Link className="back-link" to="/">
            ← Back
          </Link>
          <p className="eyebrow">ProjectBuilder</p>
          <h1>{project?.name ?? (isLoading ? 'Loading project…' : 'Project not found')}</h1>
          <p className="project-meta-line">
            <span>{project?.customer_name ?? 'Customer pending'}</span>
            <span>{project?.location ?? 'Location pending'}</span>
            <span>Due {project ? formatDate(project.bid_due_date) : isLoading ? 'Loading…' : 'No date'}</span>
          </p>
        </div>
        <div className="project-header-actions">
          {project?.organization_id ? (
            <button
              className="secondary-button"
              onClick={() => setIsCompanyLibraryOpen(true)}
              type="button"
            >
              Company library
            </button>
          ) : null}
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
        {showEstimateBuilder ? (
          <>
            <MetricCard
              label="Estimate"
              note={estimateSummary.includedCount + ' of ' + estimateSummary.itemCount + ' scopes included'}
              value={formatCurrency(estimateSummary.includedTotal)}
            />
            <MetricCard
              label="Direct cost"
              note="Labor + materials + equipment + subs"
              value={formatCurrency(estimateSummary.directCost)}
            />
            <MetricCard
              label="Markup"
              note="Overhead + profit"
              value={formatCurrency(estimateSummary.markup)}
            />
          </>
        ) : (
          <>
            <MetricCard
              label="Bid"
              value={project ? formatCurrency(project.estimated_total_cost) : '—'}
            />
            <MetricCard
              label="Actual"
              value={project ? formatCurrency(project.actual_total_cost) : '—'}
            />
            <MetricCard
              label="Profit"
              note={project ? 'Invoice ' + formatCurrency(project.invoice_amount) : undefined}
              value={project ? formatCurrency(projectProfit) : '—'}
            />
          </>
        )}
      </section>

      {project?.organization_id && isCompanyLibraryOpen ? (
        <FloatingPanel
          onClose={() => setIsCompanyLibraryOpen(false)}
          title="Company library"
          subtitle="Keep labor, equipment, and material prefills handy for the bid builder and advanced item editor."
        >
          <CompanyLibraryPanel
            employees={employeeLibrary}
            equipment={equipmentLibrary}
            hideHeader
            isBusy={isLibrarySaving}
            materials={materialLibrary}
            onCreateEmployee={handleCreateEmployeeLibraryItem}
            onCreateEquipment={handleCreateEquipmentLibraryItem}
            onCreateMaterial={handleCreateMaterialLibraryItem}
            onDeleteEmployee={handleDeleteEmployeeLibraryItem}
            onDeleteEquipment={handleDeleteEquipmentLibraryItem}
            onDeleteMaterial={handleDeleteMaterialLibraryItem}
            unitOptions={terminalItems.map((item) => item.unit ?? 'EA')}
          />
        </FloatingPanel>
      ) : null}

      {showEstimateBuilder ? (
        <article className="panel panel-large">
          <div className="panel-heading panel-heading-compact">
              <div>
                <h2>Bid builder</h2>
                <p className="panel-meta">
                  Keep the bid in the table. Open Labor, Materials, or Equipment to pull company rates without leaving the page.
                </p>
              </div>
            <span className="section-count">{isLoading ? '—' : terminalItems.length}</span>
          </div>

          {isLoading ? (
            <div className="panel-empty">Loading bid builder…</div>
          ) : terminalItems.length === 0 ? (
            <div className="panel-empty">No terminal items yet.</div>
          ) : (
            <ProjectEstimateBuilder
              employeeLibrary={employeeLibrary}
              equipmentLibrary={equipmentLibrary}
              items={terminalItems}
              materialLibrary={materialLibrary}
              onManageLibrary={() => setIsCompanyLibraryOpen(true)}
              onSaveRow={handleSaveEstimateRow}
              projectId={projectId}
              readOnly={projectMode === 'closed-estimate'}
            />
          )}
        </article>
      ) : (
        <article className="panel panel-large">
          <div className="panel-heading panel-heading-compact">
            <div>
              <h2>Terminal items</h2>
              <p className="panel-meta">
                Tracking stays item-focused for now. Open a terminal WBS item to enter actual quantities, labor, equipment, and billing details.
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
                      <strong>{formatCurrency(section.actualTotal)}</strong>
                      <span>Bid {formatCurrency(section.estimatedTotal)}</span>
                    </div>
                  </div>

                  <div className="project-item-card-list">
                    {section.items.map((item) => (
                      <Link
                        className="project-item-card"
                        key={item.project_estimate_item_id}
                        to={'/projects/' + projectId + '/items/' + item.project_estimate_item_id}
                      >
                        <div className="project-item-card-copy">
                          <div className="project-item-card-tags">
                            <span className="scope-code-pill mono">{item.item_code}</span>
                            <span className="scope-unit-pill">{item.unit}</span>
                            {!item.is_included ? <span className="worksheet-mobile-flag">Excluded</span> : null}
                          </div>
                          <strong>{item.item_name ?? 'Scope item'}</strong>
                          <span className="project-item-card-note">
                            Open item to enter actual quantities, labor, equipment, and billing.
                          </span>
                        </div>
                        <div className="project-item-card-summary">
                          <span>Actual</span>
                          <strong>{formatCurrency(item.actual_total_cost)}</strong>
                          <small>Bid {formatCurrency(item.estimated_total_cost)}</small>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </article>
      )}
    </main>
  )
}
