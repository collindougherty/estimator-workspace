import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { CompanyLibraryPanel } from '../components/CompanyLibraryPanel'
import { FloatingPanel } from '../components/FloatingPanel'
import { MetricCard } from '../components/MetricCard'
import { ProjectEstimateBuilder } from '../components/ProjectEstimateBuilder'
import { ProjectMobileWorksheet } from '../components/ProjectMobileWorksheet'
import { StatusBadge } from '../components/StatusBadge'
import { TrackingTable } from '../components/TrackingTable'
import { useCompanyLibrary } from '../hooks/useCompanyLibrary'
import {
  createProjectScope,
  deleteProjectScope,
  fetchOrganizations,
  fetchProjectItemMetrics,
  fetchProjectSummary,
  updateProjectActuals,
  updateProjectEstimateItem,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { parseNumericInput, roundCurrencyValue } from '../lib/item-detail'
import { exportProposalPdf } from '../lib/proposal-pdf'
import { applyEstimatePatchToProjectItemMetric } from '../lib/project-estimate-builder'
import { getNextItemCode, getNextSectionCode, sortScopeItems } from '../lib/scope-hierarchy'
import type {
  ProjectEstimateItemUpdate,
  ProjectItemActualUpdate,
  ProjectItemMetric,
  ProjectSummary,
} from '../lib/models'

type ProjectQuickAddDraft = {
  laborCost: string
  productionCost: string
}

type ProjectTrackingSnapshot = {
  actual: number
  equipment: number
  labor: number
  material: number
  other: number
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

const MOBILE_PROJECT_BREAKPOINT = '(max-width: 780px)'

const matchesMobileProjectViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(MOBILE_PROJECT_BREAKPOINT).matches

const createEmptyProjectQuickAddDraft = (): ProjectQuickAddDraft => ({
  laborCost: '',
  productionCost: '',
})

const toProjectTrackingSnapshot = (items: ProjectItemMetric[]): ProjectTrackingSnapshot =>
  items.reduce(
    (summary, item) => {
      summary.actual += item.actual_total_cost ?? 0
      summary.equipment += item.actual_equipment_cost ?? 0
      summary.labor += item.actual_labor_cost ?? 0
      summary.material += item.actual_material_cost ?? 0
      summary.other +=
        (item.actual_subcontract_cost ?? 0) +
        (item.actual_overhead_cost ?? 0) +
        (item.actual_profit_amount ?? 0)
      return summary
    },
    {
      actual: 0,
      equipment: 0,
      labor: 0,
      material: 0,
      other: 0,
    },
  )

const allocateProductionTotals = (
  total: number,
  items: ProjectItemMetric[],
  snapshot: ProjectTrackingSnapshot,
) => {
  const estimateMaterialWeight = items.reduce((sum, item) => sum + (item.material_cost ?? 0), 0)
  const estimateEquipmentWeight = items.reduce((sum, item) => sum + (item.estimated_equipment_cost ?? 0), 0)
  const estimateWeightTotal = estimateMaterialWeight + estimateEquipmentWeight

  if (estimateWeightTotal > 0) {
    const material = roundCurrencyValue(total * (estimateMaterialWeight / estimateWeightTotal))
    return {
      equipment: roundCurrencyValue(total - material),
      material,
    }
  }

  const actualWeightTotal = snapshot.material + snapshot.equipment

  if (actualWeightTotal > 0) {
    const material = roundCurrencyValue(total * (snapshot.material / actualWeightTotal))
    return {
      equipment: roundCurrencyValue(total - material),
      material,
    }
  }

  return {
    equipment: 0,
    material: total,
  }
}

const distributeTotal = (
  total: number,
  items: ProjectItemMetric[],
  getPrimaryWeight: (item: ProjectItemMetric) => number,
  getFallbackWeight?: (item: ProjectItemMetric) => number,
) => {
  const values = new Map<string, number>()

  if (items.length === 0) {
    return values
  }

  const primaryWeights = items.map((item) => Math.max(0, getPrimaryWeight(item)))
  const primaryWeightTotal = primaryWeights.reduce((sum, weight) => sum + weight, 0)
  const fallbackWeights = getFallbackWeight
    ? items.map((item) => Math.max(0, getFallbackWeight(item)))
    : []
  const fallbackWeightTotal = fallbackWeights.reduce((sum, weight) => sum + weight, 0)
  const weights =
    primaryWeightTotal > 0
      ? primaryWeights
      : fallbackWeightTotal > 0
        ? fallbackWeights
        : items.map(() => 1)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const totalCents = Math.max(0, Math.round(total * 100))
  const rawShares = weights.map((weight) => (totalCents * weight) / weightTotal)
  const baseShares = rawShares.map((share) => Math.floor(share))
  let remainingCents = totalCents - baseShares.reduce((sum, share) => sum + share, 0)

  rawShares
    .map((share, index) => ({
      index,
      remainder: share - baseShares[index],
    }))
    .sort((left, right) => right.remainder - left.remainder)
    .forEach(({ index }) => {
      if (remainingCents <= 0) {
        return
      }

      baseShares[index] += 1
      remainingCents -= 1
    })

  items.forEach((item, index) => {
    const itemId = item.project_estimate_item_id

    if (!itemId) {
      return
    }

    values.set(itemId, baseShares[index] / 100)
  })

  return values
}

export const ProjectPage = () => {
  const { projectId } = useParams()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [items, setItems] = useState<ProjectItemMetric[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [isCompanyLibraryOpen, setIsCompanyLibraryOpen] = useState(false)
  const [isScopeMutating, setIsScopeMutating] = useState(false)
  const [scopeDeleteTarget, setScopeDeleteTarget] = useState<ProjectItemMetric | null>(null)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProjectQuickAddSaving, setIsProjectQuickAddSaving] = useState(false)
  const [projectQuickAddDraft, setProjectQuickAddDraft] = useState<ProjectQuickAddDraft>(
    createEmptyProjectQuickAddDraft,
  )
  const [isMobileProjectViewport, setIsMobileProjectViewport] = useState(
    matchesMobileProjectViewport,
  )
  const {
    createEmployee: handleCreateEmployeeLibraryItem,
    createEquipment: handleCreateEquipmentLibraryItem,
    createMaterial: handleCreateMaterialLibraryItem,
    deleteEmployee: handleDeleteEmployeeLibraryItem,
    deleteEquipment: handleDeleteEquipmentLibraryItem,
    deleteMaterial: handleDeleteMaterialLibraryItem,
    employees: employeeLibrary,
    equipment: equipmentLibrary,
    isBusy: isLibrarySaving,
    materials: materialLibrary,
  } = useCompanyLibrary({
    onError: setScreenError,
    organizationId: project?.organization_id,
  })

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
  }, [projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(MOBILE_PROJECT_BREAKPOINT)
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileProjectViewport(event.matches)
    }

    setIsMobileProjectViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleViewportChange)

    return () => {
      mediaQuery.removeEventListener('change', handleViewportChange)
    }
  }, [])

  useEffect(() => {
    setProjectQuickAddDraft(createEmptyProjectQuickAddDraft())
  }, [projectId])

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
  const includedTrackingItems = useMemo(
    () => terminalItems.filter((item) => item.is_included && item.project_estimate_item_id),
    [terminalItems],
  )
  const projectTrackingSnapshot = useMemo(
    () => toProjectTrackingSnapshot(includedTrackingItems),
    [includedTrackingItems],
  )
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
  const trackingQuickSummary = useMemo(
    () => ({
      actual: projectTrackingSnapshot.actual,
      bid: includedTrackingItems.reduce((sum, item) => sum + (item.estimated_total_cost ?? 0), 0),
      labor: projectTrackingSnapshot.labor,
      nextActual: roundCurrencyValue(
        projectTrackingSnapshot.actual +
          parseNumericInput(projectQuickAddDraft.laborCost) +
          parseNumericInput(projectQuickAddDraft.productionCost),
      ),
      other: projectTrackingSnapshot.other,
      production: projectTrackingSnapshot.material + projectTrackingSnapshot.equipment,
    }),
    [includedTrackingItems, projectQuickAddDraft, projectTrackingSnapshot],
  )
  const hasProjectQuickAddChanges = useMemo(
    () =>
      projectQuickAddDraft.laborCost.trim().length > 0 ||
      projectQuickAddDraft.productionCost.trim().length > 0,
    [projectQuickAddDraft],
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

  const handleSaveProjectQuickAdd = async () => {
    if (includedTrackingItems.length === 0 || !hasProjectQuickAddChanges) {
      return
    }

    setIsProjectQuickAddSaving(true)
    setScreenError(null)

    const nextLaborTotal = roundCurrencyValue(
      projectTrackingSnapshot.labor + parseNumericInput(projectQuickAddDraft.laborCost),
    )
    const nextProductionTotals = allocateProductionTotals(
      roundCurrencyValue(
        projectTrackingSnapshot.material +
          projectTrackingSnapshot.equipment +
          parseNumericInput(projectQuickAddDraft.productionCost),
      ),
      includedTrackingItems,
      projectTrackingSnapshot,
    )
    const laborCostByItem = distributeTotal(
      nextLaborTotal,
      includedTrackingItems,
      (item) => item.actual_labor_cost ?? 0,
      (item) => item.estimated_labor_cost ?? 0,
    )
    const materialCostByItem = distributeTotal(
      nextProductionTotals.material,
      includedTrackingItems,
      (item) => item.actual_material_cost ?? 0,
      (item) => item.material_cost ?? 0,
    )
    const equipmentCostByItem = distributeTotal(
      nextProductionTotals.equipment,
      includedTrackingItems,
      (item) => item.actual_equipment_cost ?? 0,
      (item) => item.estimated_equipment_cost ?? 0,
    )

    try {
      await Promise.all(
        includedTrackingItems.map((item) => {
          const itemId = item.project_estimate_item_id

          if (!itemId) {
            return Promise.resolve()
          }

          return updateProjectActuals(itemId, {
            actual_equipment_breakdown: [],
            actual_equipment_cost: equipmentCostByItem.get(itemId) ?? 0,
            actual_labor_breakdown: [],
            actual_labor_cost: laborCostByItem.get(itemId) ?? 0,
            actual_material_breakdown: [],
            actual_material_cost: materialCostByItem.get(itemId) ?? 0,
          })
        }),
      )
      await loadProject({ silent: true })
      setProjectQuickAddDraft(createEmptyProjectQuickAddDraft())
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save quick costs'
      setScreenError(message)
    } finally {
      setIsProjectQuickAddSaving(false)
    }
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
          ) : isMobileProjectViewport ? (
            <div className="tracking-mobile-quick-shell">
              <section className="tracking-mobile-quick-summary">
                <div className="tracking-mobile-quick-header">
                  <div>
                    <h3>Quick add view</h3>
                    <p>
                      Keep WBS out of the way here. This mobile view rolls the job up to simple
                      project-level costs first.
                    </p>
                  </div>
                  <div className="tracking-mobile-quick-total">
                    <span>Total actual</span>
                    <strong>{formatCurrency(trackingQuickSummary.actual)}</strong>
                    <small>After add {formatCurrency(trackingQuickSummary.nextActual)}</small>
                    <small>Bid {formatCurrency(trackingQuickSummary.bid)}</small>
                  </div>
                </div>

                <div className="tracking-mobile-quick-grid">
                  <article className="tracking-mobile-quick-card">
                    <span>Labor</span>
                    <strong>{formatCurrency(trackingQuickSummary.labor)}</strong>
                  </article>
                  <article className="tracking-mobile-quick-card">
                    <span>Materials + equipment</span>
                    <strong>{formatCurrency(trackingQuickSummary.production)}</strong>
                  </article>
                </div>

                <p className="tracking-mobile-quick-note">
                  Other costs: {formatCurrency(trackingQuickSummary.other)}
                </p>

                {!isReadOnly ? (
                  <div className="tracking-mobile-quick-form">
                    <div className="tracking-mobile-quick-inputs">
                      <label className="tracking-mobile-quick-field">
                        <span>Add labor cost</span>
                        <input
                          aria-label="Add labor cost"
                          inputMode="decimal"
                          min="0"
                          onChange={(event) =>
                            setProjectQuickAddDraft((current) => ({
                              ...current,
                              laborCost: event.target.value,
                            }))
                          }
                          placeholder="0"
                          step="0.01"
                          type="number"
                          value={projectQuickAddDraft.laborCost}
                        />
                      </label>
                      <label className="tracking-mobile-quick-field">
                        <span>Add materials / equipment cost</span>
                        <input
                          aria-label="Add materials / equipment cost"
                          inputMode="decimal"
                          min="0"
                          onChange={(event) =>
                            setProjectQuickAddDraft((current) => ({
                              ...current,
                              productionCost: event.target.value,
                            }))
                          }
                          placeholder="0"
                          step="0.01"
                          type="number"
                          value={projectQuickAddDraft.productionCost}
                        />
                      </label>
                    </div>

                    <div className="tracking-mobile-quick-actions">
                      <button
                        className="primary-button"
                        disabled={!hasProjectQuickAddChanges || isProjectQuickAddSaving}
                        onClick={() => {
                          void handleSaveProjectQuickAdd()
                        }}
                        type="button"
                      >
                        {isProjectQuickAddSaving ? 'Logging…' : 'Log costs'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <details className="tracking-mobile-scope-details">
                <summary>Show WBS details</summary>
                <p>
                  Open the scope list only when you need exact allocation. The quick-add view above
                  stays project-level on purpose.
                </p>
                <ProjectMobileWorksheet
                  isSaving={null}
                  items={terminalItems}
                  mode="tracking"
                  onSaveEstimateRow={handleSaveEstimateRow}
                  onSaveTrackingRow={handleSaveActualRow}
                  readOnly={isReadOnly}
                />
              </details>
            </div>
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
