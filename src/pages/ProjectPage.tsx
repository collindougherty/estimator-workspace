import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { CompanyLibraryPanel } from '../components/CompanyLibraryPanel'
import { FloatingPanel } from '../components/FloatingPanel'
import { MetricCard } from '../components/MetricCard'
import { ProjectEstimateBuilder } from '../components/ProjectEstimateBuilder'
import { StatusBadge } from '../components/StatusBadge'
import { TrackingTable } from '../components/TrackingTable'
import {
  createProjectScope,
  createOrganizationEmployeeLibraryItem,
  deleteProjectScope,
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
  updateProjectActuals,
  updateProjectEstimateItem,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { exportProposalPdf } from '../lib/proposal-pdf'
import { applyEstimatePatchToProjectItemMetric } from '../lib/project-estimate-builder'
import { getNextItemCode, getNextSectionCode, sortScopeItems } from '../lib/scope-hierarchy'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectEstimateItemUpdate,
  ProjectItemActualUpdate,
  ProjectItemMetric,
  ProjectSummary,
} from '../lib/models'

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
  const [isScopeMutating, setIsScopeMutating] = useState(false)
  const [scopeDeleteTarget, setScopeDeleteTarget] = useState<ProjectItemMetric | null>(null)
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

  const loadProject = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!projectId) {
      return
    }

    if (!silent) {
      setIsLoading(true)
    }
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
      setItems(sortScopeItems(nextItems))
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
      if (!silent) {
        setIsLoading(false)
      }
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
  const projectProfit = (project?.estimated_total_cost ?? 0) - (project?.actual_total_cost ?? 0)
  const showEstimateBuilder = projectMode !== 'tracking'
  const isReadOnly = project?.status === 'lost' || project?.status === 'archived'
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

  const runCompanyLibraryMutation = async <T,>(
    mutation: (organizationId: string) => Promise<T>,
  ): Promise<T> => {
    setIsLibrarySaving(true)
    setScreenError(null)

    try {
      const organizationId = getProjectOrganizationId()
      const result = await mutation(organizationId)
      await loadCompanyLibraries(organizationId)
      return result
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
    return runCompanyLibraryMutation(async (organizationId) => {
      return createOrganizationEmployeeLibraryItem({
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
    return runCompanyLibraryMutation(async (organizationId) => {
      return createOrganizationEquipmentLibraryItem({
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
    return runCompanyLibraryMutation(async (organizationId) => {
      return createOrganizationMaterialLibraryItem({
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
        sortScopeItems(
          current.map((item) =>
            item.project_estimate_item_id === itemId
              ? applyEstimatePatchToProjectItemMetric(item, patch)
              : item,
          ),
        ),
      )
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save scope item'
      setScreenError(message)
      throw caughtError
    }
  }

  const handleSaveActualRow = async (
    itemId: string,
    patch: ProjectItemActualUpdate,
  ) => {
    setScreenError(null)

    try {
      await updateProjectActuals(itemId, patch)
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save tracking item'
      setScreenError(message)
      throw caughtError
    }
  }

  const handleCreateScope = async (draft: {
    itemName: string
    sectionCode?: string
    sectionName: string
    unit: string
  }) => {
    if (!projectId) {
      return
    }

    setIsScopeMutating(true)
    setScreenError(null)

    try {
      const normalizedItems = sortScopeItems(items)
      const sectionCode = draft.sectionCode?.trim() || getNextSectionCode(normalizedItems)
      const sectionName = draft.sectionName.trim()
      const itemCode = getNextItemCode(normalizedItems, sectionCode)
      const seedItem =
        normalizedItems.find((item) => item.section_code?.trim() === sectionCode) ??
        normalizedItems[normalizedItems.length - 1]

      await createProjectScope({
        projectId,
        itemCode,
        itemName: draft.itemName.trim(),
        overheadPercent: seedItem?.overhead_percent ?? 0,
        profitPercent: seedItem?.profit_percent ?? 0,
        sectionCode,
        sectionName,
        unit: draft.unit.trim().toUpperCase() || seedItem?.unit?.trim().toUpperCase() || 'EA',
      })

      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to create scope'
      setScreenError(message)
      throw caughtError
    } finally {
      setIsScopeMutating(false)
    }
  }

  const handleDeleteScope = async (item: ProjectItemMetric) => {
    setScopeDeleteTarget(item)
  }

  const confirmDeleteScope = async () => {
    const targetItem = scopeDeleteTarget
    const itemId = targetItem?.project_estimate_item_id

    if (!itemId) {
      setScopeDeleteTarget(null)
      setScreenError('Scope is missing its estimate row id')
      return
    }

    setIsScopeMutating(true)
    setScreenError(null)

    try {
      await deleteProjectScope(itemId)
      setScopeDeleteTarget(null)
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to delete scope'
      setScreenError(message)
    } finally {
      setIsScopeMutating(false)
    }
  }

  return (
    <main className="app-screen app-screen-compact">
      <header className="project-header project-header-simple">
        <div className="project-header-copy">
          <Link className="back-link" to="/">
            ← Back
          </Link>
          <p className="eyebrow">ProfitBuilder</p>
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

      {scopeDeleteTarget ? (
        <FloatingPanel
          onClose={() => {
            if (!isScopeMutating) {
              setScopeDeleteTarget(null)
            }
          }}
          size="compact"
          subtitle="This removes the scope row and any tracked actuals tied to it."
          title="Delete scope?"
        >
          <div className="scope-delete-dialog">
            <div className="scope-delete-summary">
              <strong>{scopeDeleteTarget.item_name ?? 'Scope item'}</strong>
              <span>
                {(scopeDeleteTarget.item_code ?? 'Scope') +
                  ' · ' +
                  (scopeDeleteTarget.section_name ?? 'Unassigned section')}
              </span>
            </div>
            <div className="scope-delete-actions">
              <button
                className="secondary-button"
                disabled={isScopeMutating}
                onClick={() => setScopeDeleteTarget(null)}
                type="button"
              >
                Keep scope
              </button>
              <button
                className="secondary-button secondary-button-danger"
                disabled={isScopeMutating}
                onClick={() => {
                  void confirmDeleteScope()
                }}
                type="button"
              >
                {isScopeMutating ? 'Deleting…' : 'Delete scope'}
              </button>
            </div>
          </div>
        </FloatingPanel>
      ) : null}

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
          ) : (
            <ProjectEstimateBuilder
              employeeLibrary={employeeLibrary}
              equipmentLibrary={equipmentLibrary}
              isScopeMutating={isScopeMutating}
              items={terminalItems}
              materialLibrary={materialLibrary}
              onCreateEmployeeLibraryItem={handleCreateEmployeeLibraryItem}
              onCreateEquipmentLibraryItem={handleCreateEquipmentLibraryItem}
              onCreateMaterialLibraryItem={handleCreateMaterialLibraryItem}
              onCreateScope={handleCreateScope}
              onDeleteScope={handleDeleteScope}
              onSaveRow={handleSaveEstimateRow}
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
                Track active and completed jobs in the same table rhythm as the bid builder, with each scope editable from the same bucket controls.
              </p>
            </div>
            <span className="section-count">{isLoading ? '—' : terminalItems.length}</span>
          </div>

          {isLoading ? (
            <div className="panel-empty">Loading terminal items…</div>
          ) : terminalItems.length === 0 ? (
            <div className="panel-empty">No terminal items yet.</div>
          ) : (
            <TrackingTable
              employeeLibrary={employeeLibrary}
              equipmentLibrary={equipmentLibrary}
              isSaving={null}
              items={terminalItems}
              materialLibrary={materialLibrary}
              onCreateEmployeeLibraryItem={handleCreateEmployeeLibraryItem}
              onCreateEquipmentLibraryItem={handleCreateEquipmentLibraryItem}
              onCreateMaterialLibraryItem={handleCreateMaterialLibraryItem}
              onSaveRow={handleSaveActualRow}
              readOnly={isReadOnly}
            />
          )}
        </article>
      )}
    </main>
  )
}
