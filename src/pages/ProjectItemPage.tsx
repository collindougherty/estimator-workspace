import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { CompanyLibraryPanel } from '../components/CompanyLibraryPanel'
import { MetricCard } from '../components/MetricCard'
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
  fetchProjectItemMetric,
  fetchProjectSummary,
  updateProjectActuals,
  updateProjectEstimateItem,
} from '../lib/api'
import { formatCurrency, formatDate, formatNumber } from '../lib/formatters'
import {
  buildUnitOptions,
  calculateActualOverheadCost,
  calculateExtendedCost,
  deriveUnitCost,
  parseNumericInput,
  roundCurrencyValue,
} from '../lib/item-detail'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectItemMetric,
  ProjectSummary,
} from '../lib/models'

type EstimateFormState = {
  itemName: string
  quantity: string
  unit: string
  materialCostPerUnit: string
  laborHours: string
  laborRate: string
  equipmentDays: string
  equipmentRate: string
  subcontractCost: string
  overheadPercent: string
  profitPercent: string
}

type TrackingFormState = {
  actualQuantity: string
  actualMaterialCostPerUnit: string
  actualLaborHours: string
  actualLaborRate: string
  actualEquipmentDays: string
  actualEquipmentRate: string
  actualSubcontractCost: string
  percentComplete: string
  invoiceAmount: string
}

const toEstimateFormState = (item: ProjectItemMetric): EstimateFormState => ({
  itemName: item.item_name ?? '',
  quantity: String(item.quantity ?? 0),
  unit: (item.unit ?? 'EA').toUpperCase(),
  materialCostPerUnit: String(deriveUnitCost(item.material_cost ?? 0, item.quantity ?? 0)),
  laborHours: String(item.labor_hours ?? 0),
  laborRate: String(item.labor_rate ?? 0),
  equipmentDays: String(item.equipment_days ?? 0),
  equipmentRate: String(item.equipment_rate ?? 0),
  subcontractCost: String(item.subcontract_cost ?? 0),
  overheadPercent: String(item.overhead_percent ?? 0),
  profitPercent: String(item.profit_percent ?? 0),
})

const toTrackingFormState = (item: ProjectItemMetric): TrackingFormState => ({
  actualQuantity: String(item.actual_quantity ?? item.quantity ?? 0),
  actualMaterialCostPerUnit: String(
    deriveUnitCost(item.actual_material_cost ?? 0, item.actual_quantity ?? item.quantity ?? 0),
  ),
  actualLaborHours: String(item.actual_labor_hours ?? 0),
  actualLaborRate: String(deriveUnitCost(item.actual_labor_cost ?? 0, item.actual_labor_hours ?? 0)),
  actualEquipmentDays: String(item.actual_equipment_days ?? 0),
  actualEquipmentRate: String(
    deriveUnitCost(item.actual_equipment_cost ?? 0, item.actual_equipment_days ?? 0),
  ),
  actualSubcontractCost: String(item.actual_subcontract_cost ?? 0),
  percentComplete: String(item.percent_complete ?? 0),
  invoiceAmount: String(item.invoice_amount ?? 0),
})

export const ProjectItemPage = () => {
  const { itemId, projectId } = useParams()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [item, setItem] = useState<ProjectItemMetric | null>(null)
  const [employeeLibrary, setEmployeeLibrary] = useState<OrganizationEmployeeLibraryItem[]>([])
  const [equipmentLibrary, setEquipmentLibrary] = useState<OrganizationEquipmentLibraryItem[]>([])
  const [materialLibrary, setMaterialLibrary] = useState<OrganizationMaterialLibraryItem[]>([])
  const [estimateForm, setEstimateForm] = useState<EstimateFormState | null>(null)
  const [trackingForm, setTrackingForm] = useState<TrackingFormState | null>(null)
  const [customUnits, setCustomUnits] = useState<string[]>([])
  const [selectedEmployeePresetId, setSelectedEmployeePresetId] = useState('')
  const [selectedMaterialPresetId, setSelectedMaterialPresetId] = useState('')
  const [selectedEquipmentPresetId, setSelectedEquipmentPresetId] = useState('')
  const [isCompanyLibraryOpen, setIsCompanyLibraryOpen] = useState(false)
  const [isLibrarySaving, setIsLibrarySaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)

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

  const loadItem = useCallback(async () => {
    if (!projectId || !itemId) {
      return
    }

    setIsLoading(true)
    setScreenError(null)

    try {
      const [nextProject, nextItem] = await Promise.all([
        fetchProjectSummary(projectId),
        fetchProjectItemMetric(itemId),
      ])

      if (nextProject?.organization_id) {
        await loadCompanyLibraries(nextProject.organization_id)
      } else {
        setEmployeeLibrary([])
        setEquipmentLibrary([])
        setMaterialLibrary([])
      }

      setProject(nextProject)
      setItem(nextItem)
      setSelectedEmployeePresetId('')
      setSelectedMaterialPresetId('')
      setSelectedEquipmentPresetId('')

      if (nextItem) {
        setEstimateForm(toEstimateFormState(nextItem))
        setTrackingForm(toTrackingFormState(nextItem))
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to load scope item'
      setScreenError(message)
    } finally {
      setIsLoading(false)
    }
  }, [itemId, loadCompanyLibraries, projectId])

  useEffect(() => {
    void loadItem()
  }, [loadItem])

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
  const estimateOnlyMode = projectMode !== 'tracking'

  const unitOptions = useMemo(
    () => buildUnitOptions(estimateForm?.unit ?? item?.unit, customUnits),
    [customUnits, estimateForm?.unit, item?.unit],
  )

  const estimateDerived = useMemo(() => {
    if (!estimateForm) {
      return null
    }

    const quantity = parseNumericInput(estimateForm.quantity)
    const materialCostPerUnit = parseNumericInput(estimateForm.materialCostPerUnit)
    const laborHours = parseNumericInput(estimateForm.laborHours)
    const laborRate = parseNumericInput(estimateForm.laborRate)
    const equipmentDays = parseNumericInput(estimateForm.equipmentDays)
    const equipmentRate = parseNumericInput(estimateForm.equipmentRate)
    const subcontractCost = parseNumericInput(estimateForm.subcontractCost)
    const overheadPercent = parseNumericInput(estimateForm.overheadPercent)
    const profitPercent = parseNumericInput(estimateForm.profitPercent)
    const materialCost = calculateExtendedCost(quantity, materialCostPerUnit)
    const laborCost = calculateExtendedCost(laborHours, laborRate)
    const equipmentCost = calculateExtendedCost(equipmentDays, equipmentRate)
    const directCost = roundCurrencyValue(
      laborCost + materialCost + equipmentCost + subcontractCost,
    )
    const overheadCost = calculateActualOverheadCost(directCost, overheadPercent)
    const profitCost = calculateActualOverheadCost(directCost, profitPercent)

    return {
      quantity,
      materialCostPerUnit,
      laborCost,
      equipmentCost,
      subcontractCost,
      overheadPercent,
      profitPercent,
      materialCost,
      directCost,
      overheadCost,
      profitCost,
      totalCost: roundCurrencyValue(directCost + overheadCost + profitCost),
    }
  }, [estimateForm])

  const trackingDerived = useMemo(() => {
    if (!trackingForm || !item) {
      return null
    }

    const actualQuantity = parseNumericInput(trackingForm.actualQuantity)
    const actualMaterialCostPerUnit = parseNumericInput(trackingForm.actualMaterialCostPerUnit)
    const actualLaborHours = parseNumericInput(trackingForm.actualLaborHours)
    const actualLaborRate = parseNumericInput(trackingForm.actualLaborRate)
    const actualEquipmentDays = parseNumericInput(trackingForm.actualEquipmentDays)
    const actualEquipmentRate = parseNumericInput(trackingForm.actualEquipmentRate)
    const actualSubcontractCost = parseNumericInput(trackingForm.actualSubcontractCost)
    const actualLaborCost = calculateExtendedCost(actualLaborHours, actualLaborRate)
    const actualMaterialCost = calculateExtendedCost(actualQuantity, actualMaterialCostPerUnit)
    const actualEquipmentCost = calculateExtendedCost(actualEquipmentDays, actualEquipmentRate)
    const actualDirectCost = roundCurrencyValue(
      actualLaborCost +
        actualMaterialCost +
        actualEquipmentCost +
        actualSubcontractCost,
    )
    const actualOverheadCost = calculateActualOverheadCost(
      actualDirectCost,
      item.overhead_percent,
    )

    return {
      actualQuantity,
      actualLaborHours,
      actualLaborRate,
      actualEquipmentDays,
      actualEquipmentRate,
      actualSubcontractCost,
      actualLaborCost,
      actualMaterialCost,
      actualEquipmentCost,
      actualDirectCost,
      actualOverheadCost,
      actualTotalCost: roundCurrencyValue(actualDirectCost + actualOverheadCost),
      percentComplete: parseNumericInput(trackingForm.percentComplete),
      invoiceAmount: parseNumericInput(trackingForm.invoiceAmount),
    }
  }, [item, trackingForm])

  if (!projectId || !itemId) {
    return <Navigate replace to="/" />
  }

  const handleUnitChange = (value: string) => {
    if (!estimateForm) {
      return
    }

    if (value === '__add__') {
      const nextUnit = window.prompt('Add a unit of measure', '')
      const normalizedUnit = nextUnit?.trim().toUpperCase()

      if (!normalizedUnit) {
        return
      }

      setCustomUnits((current) =>
        current.includes(normalizedUnit) ? current : [...current, normalizedUnit],
      )
      setEstimateForm((current) => (current ? { ...current, unit: normalizedUnit } : current))
      return
    }

    setEstimateForm((current) => (current ? { ...current, unit: value } : current))
  }

  const handleSaveEstimate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!itemId || !estimateForm || !estimateDerived) {
      return
    }

    setIsSaving(true)
    setScreenError(null)

    try {
      await updateProjectEstimateItem(itemId, {
        item_name: estimateForm.itemName.trim(),
        quantity: estimateDerived.quantity,
        unit: estimateForm.unit,
        material_cost: estimateDerived.materialCost,
        labor_hours: parseNumericInput(estimateForm.laborHours),
        labor_rate: parseNumericInput(estimateForm.laborRate),
        equipment_days: parseNumericInput(estimateForm.equipmentDays),
        equipment_rate: parseNumericInput(estimateForm.equipmentRate),
        subcontract_cost: estimateDerived.subcontractCost,
        overhead_percent: estimateDerived.overheadPercent,
        profit_percent: estimateDerived.profitPercent,
      })
      await loadItem()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save scope item'
      setScreenError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveTracking = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!itemId || !trackingDerived) {
      return
    }

    setIsSaving(true)
    setScreenError(null)

    try {
      await updateProjectActuals(itemId, {
        actual_quantity: trackingDerived.actualQuantity,
        actual_labor_hours: trackingDerived.actualLaborHours,
        actual_labor_cost: trackingDerived.actualLaborCost,
        actual_material_cost: trackingDerived.actualMaterialCost,
        actual_equipment_days: trackingDerived.actualEquipmentDays,
        actual_equipment_cost: trackingDerived.actualEquipmentCost,
        actual_subcontract_cost: trackingDerived.actualSubcontractCost,
        actual_overhead_cost: trackingDerived.actualOverheadCost,
        actual_profit_amount: 0,
        percent_complete: trackingDerived.percentComplete,
        invoice_amount: trackingDerived.invoiceAmount,
      })
      await loadItem()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to save actuals'
      setScreenError(message)
    } finally {
      setIsSaving(false)
    }
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

  const handleApplyMaterialPreset = (value: string) => {
    if (value === '__manage__') {
      setIsCompanyLibraryOpen(true)
      return
    }

    setSelectedMaterialPresetId(value)

    const nextPreset = materialLibrary.find((preset) => preset.id === value)

    if (!nextPreset) {
      return
    }

    if (estimateOnlyMode) {
      if (!estimateForm) {
        return
      }

      setEstimateForm((current) =>
        current
          ? {
              ...current,
              unit: nextPreset.unit.toUpperCase(),
              materialCostPerUnit: String(nextPreset.cost_per_unit),
            }
          : current,
      )
      return
    }

    if (!trackingForm) {
      return
    }

    setTrackingForm((current) =>
      current
        ? {
            ...current,
            actualMaterialCostPerUnit: String(nextPreset.cost_per_unit),
          }
        : current,
    )
  }

  const handleApplyEmployeePreset = (value: string) => {
    if (value === '__manage__') {
      setIsCompanyLibraryOpen(true)
      return
    }

    setSelectedEmployeePresetId(value)

    const nextPreset = employeeLibrary.find((preset) => preset.id === value)

    if (!nextPreset) {
      return
    }

    if (estimateOnlyMode) {
      setEstimateForm((current) =>
        current ? { ...current, laborRate: String(nextPreset.hourly_rate) } : current,
      )
      return
    }

    setTrackingForm((current) =>
      current ? { ...current, actualLaborRate: String(nextPreset.hourly_rate) } : current,
    )
  }

  const handleApplyEquipmentPreset = (value: string) => {
    if (value === '__manage__') {
      setIsCompanyLibraryOpen(true)
      return
    }

    setSelectedEquipmentPresetId(value)

    const nextPreset = equipmentLibrary.find((preset) => preset.id === value)

    if (!nextPreset) {
      return
    }

    if (estimateOnlyMode) {
      setEstimateForm((current) =>
        current ? { ...current, equipmentRate: String(nextPreset.daily_rate) } : current,
      )
      return
    }

    setTrackingForm((current) =>
      current ? { ...current, actualEquipmentRate: String(nextPreset.daily_rate) } : current,
    )
  }

  const summaryValue = estimateOnlyMode
    ? estimateDerived?.totalCost ?? item?.estimated_total_cost ?? 0
    : trackingDerived?.actualTotalCost ?? item?.actual_total_cost ?? 0

  return (
    <main className="app-screen app-screen-compact">
      <header className="project-header project-header-simple">
        <div className="project-header-copy">
          <Link className="back-link" to={`/projects/${projectId}`}>
            ← Project items
          </Link>
          <h1>{item?.item_name ?? (isLoading ? 'Loading item…' : 'Scope item not found')}</h1>
          <p className="project-meta-line">
            <span>{project?.name ?? 'Project'}</span>
            <span>
              {item?.section_code ?? '—'} · {item?.section_name ?? 'Section'}
            </span>
            <span>{item?.item_code ?? 'Code pending'}</span>
          </p>
        </div>
        <div className="project-header-actions">
          {project?.organization_id ? (
            <button
              className="secondary-button"
              onClick={() => setIsCompanyLibraryOpen((current) => !current)}
              type="button"
            >
              {isCompanyLibraryOpen ? 'Hide company library' : 'Manage company library'}
            </button>
          ) : null}
          {project?.status ? <StatusBadge status={project.status} /> : null}
        </div>
      </header>

      {screenError ? <p className="screen-error">{screenError}</p> : null}

      <section className="metrics-grid">
        <MetricCard
          label={estimateOnlyMode ? 'Estimate total' : 'Actual total'}
          value={formatCurrency(summaryValue)}
          note={estimateOnlyMode ? undefined : `Bid ${formatCurrency(item?.estimated_total_cost)}`}
        />
        <MetricCard
          label={estimateOnlyMode ? 'Unit' : 'Calculated O/H'}
          value={estimateOnlyMode ? item?.unit ?? '—' : formatCurrency(trackingDerived?.actualOverheadCost)}
          note={
            estimateOnlyMode
              ? `${formatNumber(item?.quantity)} planned`
              : `${formatNumber(item?.overhead_percent)}% of direct actuals`
          }
        />
        <MetricCard
          label={estimateOnlyMode ? 'Bid due' : 'Profit'}
          value={
            estimateOnlyMode
              ? formatDate(project?.bid_due_date)
              : formatCurrency((project?.estimated_total_cost ?? 0) - (project?.actual_total_cost ?? 0))
          }
          note={estimateOnlyMode ? undefined : `Invoice ${formatCurrency(project?.invoice_amount)}`}
        />
      </section>

      {project?.organization_id && isCompanyLibraryOpen ? (
        <CompanyLibraryPanel
          employees={employeeLibrary}
          equipment={equipmentLibrary}
          isBusy={isLibrarySaving}
          materials={materialLibrary}
          onCreateEmployee={handleCreateEmployeeLibraryItem}
          onCreateEquipment={handleCreateEquipmentLibraryItem}
          onCreateMaterial={handleCreateMaterialLibraryItem}
          onDeleteEmployee={handleDeleteEmployeeLibraryItem}
          onDeleteEquipment={handleDeleteEquipmentLibraryItem}
          onDeleteMaterial={handleDeleteMaterialLibraryItem}
          unitOptions={unitOptions}
        />
      ) : null}

      {isLoading || !item || !project ? (
        <article className="panel">
          <div className="panel-empty">Loading scope item…</div>
        </article>
      ) : estimateOnlyMode ? (
        <article className="panel panel-large">
          <form className="item-detail-form" onSubmit={handleSaveEstimate}>
            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Quantity + material</h2>
                  <p>Set the takeoff, unit, and company material pricing for this terminal item.</p>
                </div>
                <strong>{formatCurrency(estimateDerived?.materialCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Scope
                  <input
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, itemName: event.target.value } : current,
                      )
                    }
                    required
                    type="text"
                    value={estimateForm?.itemName ?? ''}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, quantity: event.target.value } : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={estimateForm?.quantity ?? '0'}
                  />
                </label>
                <label>
                  Unit of measure
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleUnitChange(event.target.value)}
                    value={estimateForm?.unit ?? item.unit ?? 'EA'}
                  >
                    {unitOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="__add__">+ Add UoM</option>
                  </select>
                </label>
                <label>
                  Company material
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyMaterialPreset(event.target.value)}
                    value={selectedMaterialPresetId}
                  >
                    <option value="">
                      {materialLibrary.length === 0
                        ? 'No company materials yet'
                        : 'Select company material'}
                    </option>
                    {materialLibrary.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Cost / unit
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current
                          ? { ...current, materialCostPerUnit: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={estimateForm?.materialCostPerUnit ?? '0'}
                  />
                </label>
                <div className="item-detail-readout">
                  <span>Material total</span>
                  <strong>{formatCurrency(estimateDerived?.materialCost)}</strong>
                </div>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Labor</h2>
                  <p>Pick a company labor prefill or override the hourly rate for this item.</p>
                </div>
                <strong>{formatCurrency(estimateDerived?.laborCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Company labor prefill
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyEmployeePreset(event.target.value)}
                    value={selectedEmployeePresetId}
                  >
                    <option value="">
                      {employeeLibrary.length === 0
                        ? 'No company labor prefills yet'
                        : 'Select labor prefill'}
                    </option>
                    {employeeLibrary.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.role ? ` · ${employee.role}` : ''}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Hours
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, laborHours: event.target.value } : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={estimateForm?.laborHours ?? '0'}
                  />
                </label>
                <label>
                  Rate / hour
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, laborRate: event.target.value } : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={estimateForm?.laborRate ?? '0'}
                  />
                </label>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Equipment</h2>
                  <p>Use company equipment defaults to seed a daily rate, then adjust as needed.</p>
                </div>
                <strong>{formatCurrency(estimateDerived?.equipmentCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Company equipment
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyEquipmentPreset(event.target.value)}
                    value={selectedEquipmentPresetId}
                  >
                    <option value="">
                      {equipmentLibrary.length === 0
                        ? 'No company equipment yet'
                        : 'Select company equipment'}
                    </option>
                    {equipmentLibrary.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Days
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, equipmentDays: event.target.value } : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={estimateForm?.equipmentDays ?? '0'}
                  />
                </label>
                <label>
                  Cost / day
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, equipmentRate: event.target.value } : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={estimateForm?.equipmentRate ?? '0'}
                  />
                </label>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Subcontract + markup</h2>
                  <p>Overhead and profit stay at the item level, but the inputs now have more room.</p>
                </div>
                <strong>{formatCurrency(estimateDerived?.totalCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Subcontract cost
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, subcontractCost: event.target.value } : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={estimateForm?.subcontractCost ?? '0'}
                  />
                </label>
                <label>
                  O/H %
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, overheadPercent: event.target.value } : current,
                      )
                    }
                    step="1"
                    type="number"
                    value={estimateForm?.overheadPercent ?? '0'}
                  />
                </label>
                <label>
                  Profit %
                  <input
                    min="0"
                    onChange={(event) =>
                      setEstimateForm((current) =>
                        current ? { ...current, profitPercent: event.target.value } : current,
                      )
                    }
                    step="1"
                    type="number"
                    value={estimateForm?.profitPercent ?? '0'}
                  />
                </label>
                <div className="item-detail-readout">
                  <span>Total estimate</span>
                  <strong>{formatCurrency(estimateDerived?.totalCost)}</strong>
                </div>
              </div>
            </section>

            {!isReadOnly ? (
              <div className="item-detail-savebar">
                <button className="primary-button" disabled={isSaving} type="submit">
                  {isSaving ? 'Saving…' : 'Save item'}
                </button>
              </div>
            ) : null}
          </form>
        </article>
      ) : (
        <article className="panel panel-large">
          <form className="item-detail-form" onSubmit={handleSaveTracking}>
            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Quantity + material</h2>
                  <p>Track actual installed quantity and the realized company material cost per unit.</p>
                </div>
                <strong>{formatCurrency(trackingDerived?.actualMaterialCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Actual quantity
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualQuantity: event.target.value }
                          : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={trackingForm?.actualQuantity ?? '0'}
                  />
                </label>
                <label>
                  Unit of measure
                  <input disabled type="text" value={item.unit ?? 'EA'} />
                </label>
                <label>
                  Company material
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyMaterialPreset(event.target.value)}
                    value={selectedMaterialPresetId}
                  >
                    <option value="">
                      {materialLibrary.length === 0
                        ? 'No company materials yet'
                        : 'Select company material'}
                    </option>
                    {materialLibrary.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Material cost / unit
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualMaterialCostPerUnit: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={trackingForm?.actualMaterialCostPerUnit ?? '0'}
                  />
                </label>
                <div className="item-detail-readout">
                  <span>Actual material total</span>
                  <strong>{formatCurrency(trackingDerived?.actualMaterialCost)}</strong>
                </div>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Labor</h2>
                  <p>Pick a company labor prefill or override the realized hourly rate.</p>
                </div>
                <strong>{formatCurrency(trackingDerived?.actualLaborCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Company labor prefill
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyEmployeePreset(event.target.value)}
                    value={selectedEmployeePresetId}
                  >
                    <option value="">
                      {employeeLibrary.length === 0
                        ? 'No company labor prefills yet'
                        : 'Select labor prefill'}
                    </option>
                    {employeeLibrary.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.role ? ` · ${employee.role}` : ''}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Actual labor hours
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualLaborHours: event.target.value }
                          : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={trackingForm?.actualLaborHours ?? '0'}
                  />
                </label>
                <label>
                  Blended labor rate
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualLaborRate: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={trackingForm?.actualLaborRate ?? '0'}
                  />
                </label>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Equipment</h2>
                  <p>Use company equipment defaults until multi-equipment rows are added.</p>
                </div>
                <strong>{formatCurrency(trackingDerived?.actualEquipmentCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Company equipment
                  <select
                    className="item-detail-select"
                    onChange={(event) => handleApplyEquipmentPreset(event.target.value)}
                    value={selectedEquipmentPresetId}
                  >
                    <option value="">
                      {equipmentLibrary.length === 0
                        ? 'No company equipment yet'
                        : 'Select company equipment'}
                    </option>
                    {equipmentLibrary.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                    <option value="__manage__">+ Manage company library</option>
                  </select>
                </label>
                <label>
                  Actual equipment days
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualEquipmentDays: event.target.value }
                          : current,
                      )
                    }
                    step="0.1"
                    type="number"
                    value={trackingForm?.actualEquipmentDays ?? '0'}
                  />
                </label>
                <label>
                  Equipment cost / day
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualEquipmentRate: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={trackingForm?.actualEquipmentRate ?? '0'}
                  />
                </label>
              </div>
            </section>

            <section className="item-detail-section">
              <div className="item-detail-section-heading">
                <div>
                  <h2>Billing + overhead</h2>
                  <p>Overhead is calculated from direct actuals; profit stays on the project summary.</p>
                </div>
                <strong>{formatCurrency(trackingDerived?.actualTotalCost)}</strong>
              </div>
              <div className="item-detail-grid">
                <label>
                  Actual subcontract cost
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, actualSubcontractCost: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={trackingForm?.actualSubcontractCost ?? '0'}
                  />
                </label>
                <label>
                  Percent complete
                  <input
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, percentComplete: event.target.value }
                          : current,
                      )
                    }
                    step="1"
                    type="number"
                    value={trackingForm?.percentComplete ?? '0'}
                  />
                </label>
                <label>
                  Invoice amount
                  <input
                    min="0"
                    onChange={(event) =>
                      setTrackingForm((current) =>
                        current
                          ? { ...current, invoiceAmount: event.target.value }
                          : current,
                      )
                    }
                    step="0.01"
                    type="number"
                    value={trackingForm?.invoiceAmount ?? '0'}
                  />
                </label>
                <div className="item-detail-readout item-detail-readout-stack">
                  <span>Direct actuals</span>
                  <strong>{formatCurrency(trackingDerived?.actualDirectCost)}</strong>
                  <small>
                    O/H {formatNumber(item.overhead_percent)}% ={' '}
                    {formatCurrency(trackingDerived?.actualOverheadCost)}
                  </small>
                </div>
              </div>
            </section>

            {!isReadOnly ? (
              <div className="item-detail-savebar">
                <button className="primary-button" disabled={isSaving} type="submit">
                  {isSaving ? 'Saving…' : 'Save item'}
                </button>
              </div>
            ) : null}
          </form>
        </article>
      )}
    </main>
  )
}
