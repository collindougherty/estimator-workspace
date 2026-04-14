import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { EstimateTable } from '../components/EstimateTable'
import { MetricCard } from '../components/MetricCard'
import { ProjectMobileWorksheet } from '../components/ProjectMobileWorksheet'
import { StatusBadge } from '../components/StatusBadge'
import { TrackingTable } from '../components/TrackingTable'
import {
  createProjectScope,
  fetchOrganizations,
  fetchPresetWbsItems,
  fetchProjectItemMetrics,
  fetchProjectSummary,
  updateProjectActuals,
  updateProjectEstimateItem,
} from '../lib/api'
import { formatCurrency, formatDate } from '../lib/formatters'
import { exportProposalPdf } from '../lib/proposal-pdf'
import type {
  PresetWbsItem,
  ProjectEstimateItemUpdate,
  ProjectItemActualUpdate,
  ProjectItemMetric,
  ProjectSummary,
} from '../lib/models'

const getDefaultScopeForm = (items: ProjectItemMetric[]) => {
  const lastItem = items[items.length - 1]

  return {
    sectionCode: lastItem?.section_code ?? '',
    sectionName: lastItem?.section_name ?? '',
    itemCode: '',
    itemName: '',
    unit: lastItem?.unit ?? 'ea',
  }
}

export const ProjectPage = () => {
  const { projectId } = useParams()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [items, setItems] = useState<ProjectItemMetric[]>([])
  const [presetScopeItems, setPresetScopeItems] = useState<PresetWbsItem[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [screenError, setScreenError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingPresetScopes, setIsLoadingPresetScopes] = useState(false)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)
  const [isScopePickerOpen, setIsScopePickerOpen] = useState(false)
  const [isCustomScopeFormOpen, setIsCustomScopeFormOpen] = useState(false)
  const [isAddingScope, setIsAddingScope] = useState(false)
  const [scopeSearch, setScopeSearch] = useState('')
  const [scopeForm, setScopeForm] = useState(() => getDefaultScopeForm([]))

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
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  useEffect(() => {
    const presetId = project?.preset_id

    if (!presetId) {
      setPresetScopeItems([])
      return
    }

    let isActive = true

    const loadPresetScopes = async () => {
      setIsLoadingPresetScopes(true)

      try {
        const nextPresetScopes = await fetchPresetWbsItems(presetId)

        if (isActive) {
          setPresetScopeItems(nextPresetScopes)
        }
      } catch (caughtError) {
        if (isActive) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load available scopes'
          setScreenError(message)
        }
      } finally {
        if (isActive) {
          setIsLoadingPresetScopes(false)
        }
      }
    }

    void loadPresetScopes()

    return () => {
      isActive = false
    }
  }, [project?.preset_id])

  const totals = useMemo(
    () => ({
      estimatedTotal: project?.estimated_total_cost ?? 0,
      actualTotal: project?.actual_total_cost ?? 0,
      invoiceAmount: project?.invoice_amount ?? 0,
    }),
    [project],
  )

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

  const isReadOnly = project?.status === 'lost' || project?.status === 'archived'

  const existingScopeCodes = useMemo(
    () => new Set(items.map((item) => item.item_code).filter(Boolean)),
    [items],
  )

  const filteredPresetScopes = useMemo(() => {
    const search = scopeSearch.trim().toLowerCase()

    return presetScopeItems.filter((scope) => {
      if (existingScopeCodes.has(scope.item_code)) {
        return false
      }

      if (!search) {
        return true
      }

      return `${scope.section_code} ${scope.section_name} ${scope.item_code} ${scope.item_name}`
        .toLowerCase()
        .includes(search)
    })
  }, [existingScopeCodes, presetScopeItems, scopeSearch])

  const sectionTitle =
    projectMode === 'tracking'
      ? isReadOnly
        ? 'Actuals'
        : 'Tracking'
      : isReadOnly
        ? 'Bid snapshot'
        : 'Estimate'

  if (!projectId) {
    return <Navigate replace to="/" />
  }

  const saveRow = async (
    itemId: string,
    patch: ProjectEstimateItemUpdate,
  ) => {
    setSavingRowId(itemId)
    setScreenError(null)

    try {
      await updateProjectEstimateItem(itemId, patch)
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save estimate row'
      setScreenError(message)
      throw caughtError
    } finally {
      setSavingRowId(null)
    }
  }

  const saveActualRow = async (
    itemId: string,
    patch: ProjectItemActualUpdate,
  ) => {
    setSavingRowId(itemId)
    setScreenError(null)

    try {
      await updateProjectActuals(itemId, patch)
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save tracking row'
      setScreenError(message)
      throw caughtError
    } finally {
      setSavingRowId(null)
    }
  }

  const handleToggleScopePicker = () => {
    setIsScopePickerOpen((current) => {
      const nextIsOpen = !current

      if (nextIsOpen) {
        setScopeSearch('')
        setScopeForm(getDefaultScopeForm(items))
      } else {
        setIsCustomScopeFormOpen(false)
      }

      return nextIsOpen
    })
  }

  const handleAddScope = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!projectId) {
      return
    }

    setIsAddingScope(true)
    setScreenError(null)

    try {
      await createProjectScope({
        projectId,
        sectionCode: scopeForm.sectionCode,
        sectionName: scopeForm.sectionName,
        itemCode: scopeForm.itemCode,
        itemName: scopeForm.itemName,
        unit: scopeForm.unit,
      })

      setScopeForm({
        sectionCode: scopeForm.sectionCode,
        sectionName: scopeForm.sectionName,
        itemCode: '',
        itemName: '',
        unit: scopeForm.unit,
      })
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Unable to add scope'
      setScreenError(message)
    } finally {
      setIsAddingScope(false)
    }
  }

  const handleAddPresetScope = async (presetScope: PresetWbsItem) => {
    if (!projectId) {
      return
    }

    setIsAddingScope(true)
    setScreenError(null)

    try {
      await createProjectScope({
        projectId,
        presetItemId: presetScope.id,
        sectionCode: presetScope.section_code,
        sectionName: presetScope.section_name,
        itemCode: presetScope.item_code,
        itemName: presetScope.item_name,
        unit: presetScope.unit,
        isIncluded: presetScope.active_default,
        quantity: presetScope.default_quantity,
        laborHours: presetScope.default_labor_hours,
        laborRate: presetScope.default_labor_rate,
        materialCost: presetScope.default_material_cost,
        equipmentDays: presetScope.default_equipment_days,
        equipmentRate: presetScope.default_equipment_rate,
        subcontractCost: presetScope.default_subcontract_cost,
        overheadPercent: presetScope.default_overhead_percent,
        profitPercent: presetScope.default_profit_percent,
      })

      setScopeSearch('')
      await loadProject({ silent: true })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to add preset scope'
      setScreenError(message)
    } finally {
      setIsAddingScope(false)
    }
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
          value={project ? formatCurrency(totals.estimatedTotal) : '—'}
        />
        <MetricCard
          label="Actual"
          value={project ? formatCurrency(totals.actualTotal) : '—'}
        />
        <MetricCard
          label="Invoice"
          value={project ? formatCurrency(totals.invoiceAmount) : '—'}
        />
      </section>

      <article className="panel panel-large">
        <div className="panel-heading panel-heading-compact project-worksheet-header">
          <div>
            <h2>{sectionTitle}</h2>
          </div>
          {!isReadOnly ? (
            <div className="scope-picker">
              <button
                className="secondary-button"
                onClick={handleToggleScopePicker}
                type="button"
              >
                {isScopePickerOpen ? 'Close scope picker' : 'Add scope'}
              </button>
              {isScopePickerOpen ? (
                <div className="scope-picker-popover">
                  <div className="scope-picker-header">
                    <div>
                      <h3>Scope library</h3>
                      <p>Search the preset scope list or add something custom.</p>
                    </div>
                  </div>
                  <label className="scope-picker-search">
                    <span>Search scopes</span>
                    <input
                      onChange={(event) => setScopeSearch(event.target.value)}
                      placeholder="Search by code, section, or name"
                      type="search"
                      value={scopeSearch}
                    />
                  </label>
                  <div className="scope-picker-list">
                    {isLoadingPresetScopes ? (
                      <div className="scope-picker-empty">Loading preset scopes…</div>
                    ) : filteredPresetScopes.length === 0 ? (
                      <div className="scope-picker-empty">No preset scopes match that search.</div>
                    ) : (
                      filteredPresetScopes.map((presetScope) => (
                        <button
                          className="scope-picker-option"
                          disabled={isAddingScope}
                          key={presetScope.id}
                          onClick={() => {
                            void handleAddPresetScope(presetScope)
                          }}
                          type="button"
                        >
                          <div>
                            <strong>{presetScope.item_name}</strong>
                            <span>
                              {presetScope.section_code} · {presetScope.section_name} ·{' '}
                              {presetScope.item_code}
                            </span>
                          </div>
                          <span>{isAddingScope ? 'Adding…' : 'Add'}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="scope-picker-divider" />
                  <button
                    className="ghost-button scope-picker-custom-toggle"
                    onClick={() => {
                      setIsCustomScopeFormOpen((current) => !current)
                      setScopeForm(getDefaultScopeForm(items))
                    }}
                    type="button"
                  >
                    {isCustomScopeFormOpen ? 'Hide custom scope' : 'Add custom scope'}
                  </button>
                  {isCustomScopeFormOpen ? (
                    <form className="scope-picker-form" onSubmit={handleAddScope}>
                      <label>
                        Section code
                        <input
                          onChange={(event) =>
                            setScopeForm((current) => ({
                              ...current,
                              sectionCode: event.target.value,
                            }))
                          }
                          required
                          type="text"
                          value={scopeForm.sectionCode}
                        />
                      </label>
                      <label>
                        Section name
                        <input
                          onChange={(event) =>
                            setScopeForm((current) => ({
                              ...current,
                              sectionName: event.target.value,
                            }))
                          }
                          required
                          type="text"
                          value={scopeForm.sectionName}
                        />
                      </label>
                      <label>
                        WBS code
                        <input
                          onChange={(event) =>
                            setScopeForm((current) => ({
                              ...current,
                              itemCode: event.target.value,
                            }))
                          }
                          required
                          type="text"
                          value={scopeForm.itemCode}
                        />
                      </label>
                      <label>
                        Scope
                        <input
                          onChange={(event) =>
                            setScopeForm((current) => ({
                              ...current,
                              itemName: event.target.value,
                            }))
                          }
                          required
                          type="text"
                          value={scopeForm.itemName}
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          onChange={(event) =>
                            setScopeForm((current) => ({
                              ...current,
                              unit: event.target.value,
                            }))
                          }
                          required
                          type="text"
                          value={scopeForm.unit}
                        />
                      </label>
                      <button className="primary-button" disabled={isAddingScope} type="submit">
                        {isAddingScope ? 'Adding…' : 'Add custom scope'}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {isLoading ? (
          <div className="panel-empty">Loading estimate rows…</div>
        ) : (
          <>
            <div className="worksheet-mobile-shell">
              <ProjectMobileWorksheet
                isSaving={savingRowId}
                items={items}
                mode={projectMode === 'tracking' ? 'tracking' : 'estimate'}
                onSaveEstimateRow={saveRow}
                onSaveTrackingRow={saveActualRow}
                readOnly={isReadOnly}
              />
            </div>
            <div className="worksheet-desktop-shell">
              {projectMode === 'tracking' ? (
                <TrackingTable
                  items={items}
                  isSaving={savingRowId}
                  onSaveRow={saveActualRow}
                  readOnly={isReadOnly}
                />
              ) : (
                <EstimateTable
                  items={items}
                  isSaving={savingRowId}
                  onSaveRow={saveRow}
                  readOnly={isReadOnly}
                />
              )}
            </div>
          </>
        )}
      </article>
    </main>
  )
}
