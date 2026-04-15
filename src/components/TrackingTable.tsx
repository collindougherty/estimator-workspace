import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { formatCurrency, formatNumber } from '../lib/formatters'
import {
  calculateActualOverheadCost,
  parseNumericInput,
  roundCurrencyValue,
} from '../lib/item-detail'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectItemActualUpdate,
  ProjectItemMetric,
} from '../lib/models'
import {
  calculateEquipmentBreakdownTotals,
  calculateLaborBreakdownTotals,
  calculateMaterialBreakdownTotals,
  createEquipmentBreakdownEntry,
  createEquipmentBreakdownEntryFromEquipment,
  createLaborBreakdownEntry,
  createLaborBreakdownEntryFromEmployee,
  createMaterialBreakdownEntry,
  createMaterialBreakdownEntryFromMaterial,
  equipmentBreakdownChanged,
  getActualEquipmentBreakdown,
  getActualLaborBreakdown,
  getActualMaterialBreakdown,
  laborBreakdownChanged,
  materialBreakdownChanged,
  serializeEquipmentBreakdown,
  serializeLaborBreakdown,
  serializeMaterialBreakdown,
  type EquipmentBreakdownEntry,
  type LaborBreakdownEntry,
  type MaterialBreakdownEntry,
} from '../lib/resource-breakdowns'
import { BucketControlButton } from './BucketControlButton'
import { FloatingPanel } from './FloatingPanel'
import {
  EquipmentBreakdownFields,
  LaborBreakdownFields,
  MaterialBreakdownFields,
} from './ResourceBreakdownFields'

type RowSaveState = 'saved' | 'pending' | 'saving' | 'error'
type BucketKey = 'equipment' | 'labor' | 'materials' | 'markup' | 'subcontract'
type BucketPanelState = {
  bucket: BucketKey
  itemId: string
}

type TrackingDraft = {
  actual_quantity: string
  actual_subcontract_cost: string
  actualEquipmentBreakdown: EquipmentBreakdownEntry[]
  actualLaborBreakdown: LaborBreakdownEntry[]
  actualMaterialBreakdown: MaterialBreakdownEntry[]
}

type TrackingDerived = {
  actual_direct_cost: number
  actual_equipment_cost: number
  actual_equipment_days: number
  actual_labor_cost: number
  actual_labor_hours: number
  actual_material_cost: number
  actual_overhead_cost: number
  actual_profit_amount: number
  actual_quantity: number
  actual_subcontract_cost: number
  actual_total_cost: number
}

const toTrackingDraft = (item: ProjectItemMetric): TrackingDraft => ({
  actual_quantity: String(item.actual_quantity ?? 0),
  actual_subcontract_cost: String(item.actual_subcontract_cost ?? 0),
  actualEquipmentBreakdown: getActualEquipmentBreakdown(item),
  actualLaborBreakdown: getActualLaborBreakdown(item),
  actualMaterialBreakdown: getActualMaterialBreakdown(item),
})

const isDraftDirty = (draft: TrackingDraft, item: ProjectItemMetric) => {
  const baseline = toTrackingDraft(item)

  return (
    parseNumericInput(draft.actual_quantity) !== parseNumericInput(baseline.actual_quantity) ||
    parseNumericInput(draft.actual_subcontract_cost) !==
      parseNumericInput(baseline.actual_subcontract_cost) ||
    laborBreakdownChanged(draft.actualLaborBreakdown, baseline.actualLaborBreakdown) ||
    materialBreakdownChanged(draft.actualMaterialBreakdown, baseline.actualMaterialBreakdown) ||
    equipmentBreakdownChanged(
      draft.actualEquipmentBreakdown,
      baseline.actualEquipmentBreakdown,
    )
  )
}

const getBucketLabel = (bucket: BucketKey) => {
  if (bucket === 'labor') {
    return 'Labor'
  }

  if (bucket === 'equipment') {
    return 'Equipment'
  }

  if (bucket === 'subcontract') {
    return 'Subs'
  }

  if (bucket === 'markup') {
    return 'O/H + profit'
  }

  return 'Materials'
}

const calculateTrackingDerived = (
  draft: TrackingDraft,
  item: Pick<ProjectItemMetric, 'overhead_percent'>,
): TrackingDerived => {
  const actual_quantity = parseNumericInput(draft.actual_quantity)
  const actual_subcontract_cost = parseNumericInput(draft.actual_subcontract_cost)
  const laborTotals = calculateLaborBreakdownTotals(draft.actualLaborBreakdown)
  const materialTotals = calculateMaterialBreakdownTotals(draft.actualMaterialBreakdown)
  const equipmentTotals = calculateEquipmentBreakdownTotals(draft.actualEquipmentBreakdown)
  const actual_direct_cost = roundCurrencyValue(
    laborTotals.cost +
      materialTotals.cost +
      equipmentTotals.cost +
      actual_subcontract_cost,
  )
  const actual_overhead_cost = calculateActualOverheadCost(
    actual_direct_cost,
    item.overhead_percent,
  )
  const actual_profit_amount = 0

  return {
    actual_direct_cost,
    actual_equipment_cost: equipmentTotals.cost,
    actual_equipment_days: equipmentTotals.days,
    actual_labor_cost: laborTotals.cost,
    actual_labor_hours: laborTotals.hours,
    actual_material_cost: materialTotals.cost,
    actual_overhead_cost,
    actual_profit_amount,
    actual_quantity,
    actual_subcontract_cost,
    actual_total_cost: roundCurrencyValue(
      actual_direct_cost + actual_overhead_cost + actual_profit_amount,
    ),
  }
}

const getTrackingBucketTotal = (bucket: BucketKey, derived: TrackingDerived) => {
  if (bucket === 'labor') {
    return derived.actual_labor_cost
  }

  if (bucket === 'equipment') {
    return derived.actual_equipment_cost
  }

  if (bucket === 'subcontract') {
    return derived.actual_subcontract_cost
  }

  if (bucket === 'markup') {
    return derived.actual_overhead_cost + derived.actual_profit_amount
  }

  return derived.actual_material_cost
}

const getTrackingBucketSummary = (
  bucket: BucketKey,
  item: ProjectItemMetric,
  derived: TrackingDerived,
) => {
  if (bucket === 'labor') {
    return `${formatNumber(derived.actual_labor_hours)} hrs tracked`
  }

  if (bucket === 'equipment') {
    return `${formatNumber(derived.actual_equipment_days)} days tracked`
  }

  if (bucket === 'subcontract') {
    return derived.actual_subcontract_cost > 0 ? 'Flat subcontract actual' : 'Tap to add actual'
  }

  if (bucket === 'markup') {
    return `${formatNumber(item.overhead_percent)}% O/H auto`
  }

  if (derived.actual_quantity > 0) {
    return `${formatNumber(derived.actual_quantity)} ${item.unit ?? 'EA'} tracked`
  }

  return derived.actual_material_cost > 0 ? 'Material actual loaded' : `0 ${item.unit ?? 'EA'} tracked`
}

const getTrackingBucketDetail = (bucket: BucketKey, item: ProjectItemMetric) => {
  if (bucket === 'labor') {
    return `Bid ${formatCurrency(item.estimated_labor_cost)}`
  }

  if (bucket === 'equipment') {
    return `Bid ${formatCurrency(item.estimated_equipment_cost)}`
  }

  if (bucket === 'subcontract') {
    return `Bid ${formatCurrency(item.subcontract_cost)}`
  }

  if (bucket === 'markup') {
    return `Bid ${formatCurrency(item.estimated_overhead_cost)} O/H`
  }

  return `Bid ${formatCurrency(item.material_cost)}`
}

const TrackingBucketPanel = ({
  draft,
  employeeLibrary,
  equipmentLibrary,
  item,
  materialLibrary,
  onClose,
  onCommit,
  onCreateEmployeeLibraryItem,
  onCreateEquipmentLibraryItem,
  onCreateMaterialLibraryItem,
  onUpdateDraft,
  type,
}: {
  draft: TrackingDraft
  employeeLibrary: OrganizationEmployeeLibraryItem[]
  equipmentLibrary: OrganizationEquipmentLibraryItem[]
  item: ProjectItemMetric
  materialLibrary: OrganizationMaterialLibraryItem[]
  onClose: () => void
  onCommit: () => void
  onCreateEmployeeLibraryItem: (draft: {
    hourlyRate: number
    name: string
    role: string
  }) => Promise<OrganizationEmployeeLibraryItem | void>
  onCreateEquipmentLibraryItem: (draft: {
    dailyRate: number
    name: string
  }) => Promise<OrganizationEquipmentLibraryItem | void>
  onCreateMaterialLibraryItem: (draft: {
    costPerUnit: number
    name: string
    unit: string
  }) => Promise<OrganizationMaterialLibraryItem | void>
  onUpdateDraft: (patch: Partial<TrackingDraft>, persistImmediately?: boolean) => void
  type: BucketKey
}) => {
  const [searchValue, setSearchValue] = useState('')
  const derived = useMemo(() => calculateTrackingDerived(draft, item), [draft, item])
  const searchNeedle = searchValue.trim().toLowerCase()
  const filteredEmployees = useMemo(
    () =>
      employeeLibrary.filter((employee) => {
        if (!searchNeedle) {
          return true
        }

        return (employee.name + ' ' + (employee.role ?? ''))
          .toLowerCase()
          .includes(searchNeedle)
      }),
    [employeeLibrary, searchNeedle],
  )
  const filteredEquipment = useMemo(
    () =>
      equipmentLibrary.filter((equipmentItem) => {
        if (!searchNeedle) {
          return true
        }

        return equipmentItem.name.toLowerCase().includes(searchNeedle)
      }),
    [equipmentLibrary, searchNeedle],
  )
  const filteredMaterials = useMemo(
    () =>
      materialLibrary.filter((material) => {
        if (!searchNeedle) {
          return true
        }

        return (material.name + ' ' + material.unit).toLowerCase().includes(searchNeedle)
      }),
    [materialLibrary, searchNeedle],
  )
  const title =
    type === 'subcontract'
      ? 'Subcontract actuals'
      : type === 'markup'
        ? 'Overhead actuals'
        : getBucketLabel(type) + ' actuals'
  const currentValueLabel =
    type === 'markup' ? 'Overhead actual' : `${getBucketLabel(type)} actual`
  const isLibraryBucket =
    type === 'labor' || type === 'equipment' || type === 'materials'
  const updateLaborBreakdown = (nextEntries: TrackingDraft['actualLaborBreakdown']) => {
    onUpdateDraft({ actualLaborBreakdown: nextEntries })
  }
  const updateEquipmentBreakdown = (
    nextEntries: TrackingDraft['actualEquipmentBreakdown'],
  ) => {
    onUpdateDraft({ actualEquipmentBreakdown: nextEntries })
  }
  const updateMaterialBreakdown = (
    nextEntries: TrackingDraft['actualMaterialBreakdown'],
  ) => {
    onUpdateDraft({ actualMaterialBreakdown: nextEntries })
  }

  return (
    <FloatingPanel
      className={isLibraryBucket ? 'floating-panel-resource-sheet' : undefined}
      onClose={onClose}
      size={isLibraryBucket ? 'wide' : 'compact'}
      subtitle={
        isLibraryBucket
          ? 'Track actual ' + getBucketLabel(type).toLowerCase() + ' mix for ' + (item.item_name ?? 'this item') + '.'
          : 'Adjust actuals for ' + (item.item_name ?? 'this item') + '.'
      }
      title={title}
    >
      {isLibraryBucket ? (
        <div className="resource-sheet-grid">
          <section className="resource-sheet-editor">
            <div className="resource-sheet-editor-header">
              <div>
                <h3>Current mix</h3>
                <p>
                  {item.item_code ?? 'Scope'} · {item.item_name ?? 'Scope item'}
                </p>
              </div>
              <div className="resource-sheet-readout">
                <span>{getBucketLabel(type)} actual</span>
                <strong>{formatCurrency(getTrackingBucketTotal(type, derived))}</strong>
              </div>
            </div>

            <div className="resource-sheet-column-body resource-sheet-editor-body">
              {type === 'labor' ? (
                <>
                  <div className="resource-sheet-readout resource-sheet-readout-soft">
                    <span>Crew actual</span>
                    <strong>{formatCurrency(derived.actual_labor_cost)}</strong>
                    <small>
                      {formatNumber(derived.actual_labor_hours)} hrs · Bid {formatCurrency(item.estimated_labor_cost)}
                    </small>
                  </div>
                  <LaborBreakdownFields
                    employees={employeeLibrary}
                    entries={draft.actualLaborBreakdown}
                    onAddManual={() => {
                      updateLaborBreakdown([
                        ...draft.actualLaborBreakdown,
                        createLaborBreakdownEntry(),
                      ])
                    }}
                    onCreateLibraryItem={onCreateEmployeeLibraryItem}
                    onRemove={(entryId) => {
                      updateLaborBreakdown(
                        draft.actualLaborBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.actualLaborBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft(
                        { actualLaborBreakdown: nextEntries },
                        persistImmediately,
                      )
                    }}
                  />
                </>
              ) : null}

              {type === 'materials' ? (
                <>
                  <div className="resource-sheet-form-grid">
                    <label className="resource-sheet-field">
                      <span>Actual quantity</span>
                      <input
                        aria-label={`${item.item_code} actual quantity`}
                        min="0"
                        onBlur={onCommit}
                        onChange={(event) =>
                          onUpdateDraft({ actual_quantity: event.target.value })
                        }
                        step="0.1"
                        type="number"
                        value={draft.actual_quantity}
                      />
                    </label>
                    <div className="resource-sheet-readout resource-sheet-readout-soft">
                      <span>Material actual</span>
                      <strong>{formatCurrency(derived.actual_material_cost)}</strong>
                      <small>
                        Bid {formatCurrency(item.material_cost)} · {formatNumber(item.quantity)} {item.unit}
                      </small>
                    </div>
                  </div>
                  <MaterialBreakdownFields
                    materials={materialLibrary}
                    entries={draft.actualMaterialBreakdown}
                    onAddManual={() => {
                      updateMaterialBreakdown([
                        ...draft.actualMaterialBreakdown,
                        createMaterialBreakdownEntry({ unit: item.unit ?? 'EA' }),
                      ])
                    }}
                    onCreateLibraryItem={onCreateMaterialLibraryItem}
                    onRemove={(entryId) => {
                      updateMaterialBreakdown(
                        draft.actualMaterialBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.actualMaterialBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft(
                        { actualMaterialBreakdown: nextEntries },
                        persistImmediately,
                      )
                    }}
                  />
                </>
              ) : null}

              {type === 'equipment' ? (
                <>
                  <div className="resource-sheet-readout resource-sheet-readout-soft">
                    <span>Equipment actual</span>
                    <strong>{formatCurrency(derived.actual_equipment_cost)}</strong>
                    <small>
                      {formatNumber(derived.actual_equipment_days)} days · Bid {formatCurrency(item.estimated_equipment_cost)}
                    </small>
                  </div>
                  <EquipmentBreakdownFields
                    equipment={equipmentLibrary}
                    entries={draft.actualEquipmentBreakdown}
                    onAddManual={() => {
                      updateEquipmentBreakdown([
                        ...draft.actualEquipmentBreakdown,
                        createEquipmentBreakdownEntry(),
                      ])
                    }}
                    onCreateLibraryItem={onCreateEquipmentLibraryItem}
                    onRemove={(entryId) => {
                      updateEquipmentBreakdown(
                        draft.actualEquipmentBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.actualEquipmentBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft(
                        { actualEquipmentBreakdown: nextEntries },
                        persistImmediately,
                      )
                    }}
                  />
                </>
              ) : null}
            </div>
          </section>

          <section className="resource-sheet-library">
            <div className="resource-sheet-library-header">
              <div>
                <h3>Presets</h3>
                <p>Search and tap to add.</p>
              </div>
            </div>

            <div className="resource-sheet-column-body resource-sheet-library-body">
              <label className="resource-sheet-search">
                <span>Search</span>
                <input
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder={'Search ' + getBucketLabel(type).toLowerCase() + ' prefills'}
                  type="search"
                  value={searchValue}
                />
              </label>

              {type === 'labor' ? (
                <div className="resource-sheet-list">
                  {filteredEmployees.length === 0 ? (
                    <div className="resource-sheet-empty">No labor prefills match yet.</div>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <button
                        className="resource-sheet-option"
                        key={employee.id}
                        onClick={() => {
                          updateLaborBreakdown([
                            ...draft.actualLaborBreakdown,
                            createLaborBreakdownEntryFromEmployee(employee),
                          ])
                        }}
                        type="button"
                      >
                        <div className="resource-sheet-option-copy">
                          <strong>{employee.name}</strong>
                          <span>{employee.role || 'Labor prefill'}</span>
                        </div>
                        <div className="resource-sheet-option-value">
                          <strong>{formatCurrency(employee.hourly_rate)}</strong>
                          <span>/ hr · Add</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {type === 'equipment' ? (
                <div className="resource-sheet-list">
                  {filteredEquipment.length === 0 ? (
                    <div className="resource-sheet-empty">No equipment prefills match yet.</div>
                  ) : (
                    filteredEquipment.map((equipmentItem) => (
                      <button
                        className="resource-sheet-option"
                        key={equipmentItem.id}
                        onClick={() => {
                          updateEquipmentBreakdown([
                            ...draft.actualEquipmentBreakdown,
                            createEquipmentBreakdownEntryFromEquipment(equipmentItem),
                          ])
                        }}
                        type="button"
                      >
                        <div className="resource-sheet-option-copy">
                          <strong>{equipmentItem.name}</strong>
                          <span>Equipment prefill</span>
                        </div>
                        <div className="resource-sheet-option-value">
                          <strong>{formatCurrency(equipmentItem.daily_rate)}</strong>
                          <span>/ day · Add</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {type === 'materials' ? (
                <div className="resource-sheet-list">
                  {filteredMaterials.length === 0 ? (
                    <div className="resource-sheet-empty">No material prefills match yet.</div>
                  ) : (
                    filteredMaterials.map((material) => (
                      <button
                        className="resource-sheet-option"
                        key={material.id}
                        onClick={() => {
                          updateMaterialBreakdown([
                            ...draft.actualMaterialBreakdown,
                            createMaterialBreakdownEntryFromMaterial(material),
                          ])
                        }}
                        type="button"
                      >
                        <div className="resource-sheet-option-copy">
                          <strong>{material.name}</strong>
                          <span>{material.unit}</span>
                        </div>
                        <div className="resource-sheet-option-value">
                          <strong>{formatCurrency(material.cost_per_unit)}</strong>
                          <span>/ unit · Add</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : (
        <section className="resource-sheet-editor resource-sheet-editor-standalone">
          <div className="resource-sheet-editor-header">
            <div>
              <h3>Current values</h3>
              <p>
                {item.item_code ?? 'Scope'} · {item.item_name ?? 'Scope item'}
              </p>
            </div>
            <div className="resource-sheet-readout">
              <span>{currentValueLabel}</span>
              <strong>{formatCurrency(getTrackingBucketTotal(type, derived))}</strong>
            </div>
          </div>

          {type === 'subcontract' ? (
            <div className="resource-sheet-form">
              <label className="resource-sheet-field">
                <span>Subcontract cost</span>
                <input
                  aria-label={`${item.item_code} actual subcontract cost`}
                  min="0"
                  onBlur={onCommit}
                  onChange={(event) =>
                    onUpdateDraft({ actual_subcontract_cost: event.target.value })
                  }
                  step="0.1"
                  type="number"
                  value={draft.actual_subcontract_cost}
                />
              </label>
              <div className="resource-sheet-readout resource-sheet-readout-soft">
                <span>Bid reference</span>
                <strong>{formatCurrency(item.subcontract_cost)}</strong>
                <small>Original subcontract allowance</small>
              </div>
            </div>
          ) : null}

          {type === 'markup' ? (
            <div className="resource-sheet-form">
              <div className="resource-sheet-readout resource-sheet-readout-soft">
                <span>Actual overhead</span>
                <strong>{formatCurrency(derived.actual_overhead_cost)}</strong>
                <small>
                  {formatNumber(item.overhead_percent)}% of {formatCurrency(derived.actual_direct_cost)} direct actuals
                </small>
              </div>
              <div className="resource-sheet-form-grid">
                <div className="resource-sheet-readout resource-sheet-readout-soft">
                  <span>Direct actuals</span>
                  <strong>{formatCurrency(derived.actual_direct_cost)}</strong>
                  <small>Labor + materials + equipment + subs</small>
                </div>
                <div className="resource-sheet-readout resource-sheet-readout-soft">
                  <span>Profit</span>
                  <strong>{formatCurrency(0)}</strong>
                  <small>Tracked on the project summary, not typed here</small>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </FloatingPanel>
  )
}

export const TrackingTable = ({
  employeeLibrary = [],
  equipmentLibrary = [],
  items,
  isSaving,
  materialLibrary = [],
  onCreateEmployeeLibraryItem,
  onCreateEquipmentLibraryItem,
  onCreateMaterialLibraryItem,
  onSaveRow,
  readOnly = false,
}: {
  employeeLibrary?: OrganizationEmployeeLibraryItem[]
  equipmentLibrary?: OrganizationEquipmentLibraryItem[]
  items: ProjectItemMetric[]
  isSaving: string | null
  materialLibrary?: OrganizationMaterialLibraryItem[]
  onCreateEmployeeLibraryItem: (draft: {
    hourlyRate: number
    name: string
    role: string
  }) => Promise<OrganizationEmployeeLibraryItem | void>
  onCreateEquipmentLibraryItem: (draft: {
    dailyRate: number
    name: string
  }) => Promise<OrganizationEquipmentLibraryItem | void>
  onCreateMaterialLibraryItem: (draft: {
    costPerUnit: number
    name: string
    unit: string
  }) => Promise<OrganizationMaterialLibraryItem | void>
  onSaveRow: (itemId: string, patch: ProjectItemActualUpdate) => Promise<void>
  readOnly?: boolean
}) => {
  const [draftOverrides, setDraftOverrides] = useState<Record<string, TrackingDraft>>({})
  const [openBucket, setOpenBucket] = useState<BucketPanelState | null>(null)
  const [rowSaveState, setRowSaveState] = useState<Record<string, RowSaveState>>({})
  const saveTimeouts = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})

  useEffect(
    () => () => {
      Object.values(saveTimeouts.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
    },
    [],
  )

  const itemsByKey = useMemo(
    () =>
      new Map(items.map((item) => [item.project_estimate_item_id ?? item.item_code ?? '', item])),
    [items],
  )

  const drafts = useMemo(
    () =>
      Object.fromEntries(
        items.map((item) => {
          const key = item.project_estimate_item_id ?? item.item_code ?? ''
          return [key, draftOverrides[key] ?? toTrackingDraft(item)]
        }),
      ),
    [draftOverrides, items],
  )

  const derivedByKey = useMemo(
    () =>
      Object.fromEntries(
        items.map((item) => {
          const key = item.project_estimate_item_id ?? item.item_code ?? ''
          return [key, calculateTrackingDerived(drafts[key], item)]
        }),
      ),
    [drafts, items],
  )

  const sectionTotals = useMemo(() => {
    const totals = new Map<string, { actual: number; bid: number }>()

    for (const item of items) {
      const key = `${item.section_code}:${item.section_name}`
      const running = totals.get(key) ?? { actual: 0, bid: 0 }
      const itemKey = item.project_estimate_item_id ?? item.item_code ?? ''
      const derived = derivedByKey[itemKey]
      totals.set(key, {
        actual: running.actual + (derived?.actual_total_cost ?? 0),
        bid: running.bid + (item.estimated_total_cost ?? 0),
      })
    }

    return totals
  }, [derivedByKey, items])

  const displayRows = useMemo(
    () =>
      items.map((item, index) => {
        const previousItem = items[index - 1]
        const showSectionHeading =
          index === 0 ||
          previousItem?.section_code !== item.section_code ||
          previousItem?.section_name !== item.section_name

        return {
          item,
          sectionKey: `${item.section_code}:${item.section_name}`,
          showSectionHeading,
        }
      }),
    [items],
  )

  const persistDraft = async (key: string, draft: TrackingDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    if (!isDraftDirty(draft, item)) {
      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
      return
    }

    const derived = calculateTrackingDerived(draft, item)
    setRowSaveState((current) => ({ ...current, [key]: 'saving' }))

    try {
      await onSaveRow(key, {
        actual_equipment_breakdown: serializeEquipmentBreakdown(draft.actualEquipmentBreakdown),
        actual_equipment_cost: derived.actual_equipment_cost,
        actual_equipment_days: derived.actual_equipment_days,
        actual_labor_breakdown: serializeLaborBreakdown(draft.actualLaborBreakdown),
        actual_labor_cost: derived.actual_labor_cost,
        actual_labor_hours: derived.actual_labor_hours,
        actual_material_breakdown: serializeMaterialBreakdown(draft.actualMaterialBreakdown),
        actual_material_cost: derived.actual_material_cost,
        actual_overhead_cost: derived.actual_overhead_cost,
        actual_profit_amount: derived.actual_profit_amount,
        actual_quantity: derived.actual_quantity,
        actual_subcontract_cost: derived.actual_subcontract_cost,
      })

      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
    } catch {
      setRowSaveState((current) => ({ ...current, [key]: 'error' }))
    }
  }

  const queueAutoSave = (key: string, draft: TrackingDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'pending' }))
    window.clearTimeout(saveTimeouts.current[key])
    saveTimeouts.current[key] = window.setTimeout(() => {
      void persistDraft(key, draft, item)
    }, 1200)
  }

  const flushAutoSave = (key: string, draft: TrackingDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    window.clearTimeout(saveTimeouts.current[key])
    void persistDraft(key, draft, item)
  }

  const handleCloseBucket = () => {
    if (openBucket) {
      const item = itemsByKey.get(openBucket.itemId)
      const draft = drafts[openBucket.itemId]

      if (item && draft) {
        flushAutoSave(openBucket.itemId, draft, item)
      }
    }

    setOpenBucket(null)
  }

  const updateDraft = (
    key: string,
    patch: Partial<TrackingDraft>,
    persistImmediately = false,
  ) => {
    const item = itemsByKey.get(key)
    const baselineDraft = item ? drafts[key] ?? toTrackingDraft(item) : null
    let nextDraft: TrackingDraft | null = null

    setDraftOverrides((current) => {
      const currentDraft = current[key] ?? baselineDraft

      if (!currentDraft) {
        return current
      }

      nextDraft = {
        ...currentDraft,
        ...patch,
      }

      return {
        ...current,
        [key]: nextDraft,
      }
    })

    if (!item || !nextDraft) {
      return
    }

    if (persistImmediately) {
      flushAutoSave(key, nextDraft, item)
      return
    }

    queueAutoSave(key, nextDraft, item)
  }

  const getSaveLabel = (key: string) => {
    if (isSaving === key || rowSaveState[key] === 'saving' || rowSaveState[key] === 'pending') {
      return 'Syncing…'
    }

    if (rowSaveState[key] === 'error') {
      return 'Needs retry'
    }

    return 'Synced'
  }

  const renderBucketButton = (bucket: BucketKey, key: string, item: ProjectItemMetric, derived: TrackingDerived) => (
    <BucketControlButton
      amount={formatCurrency(getTrackingBucketTotal(bucket, derived))}
      ariaLabel={`${item.item_name ?? item.item_code ?? 'Scope item'} ${getBucketLabel(bucket)}`}
      className="bucket-control-button-compact"
      detail={getTrackingBucketDetail(bucket, item)}
      disabled={readOnly}
      onClick={() => setOpenBucket({ bucket, itemId: key })}
      summary={getTrackingBucketSummary(bucket, item, derived)}
    />
  )

  return (
    <div className="table-shell">
      <table className="estimate-table tracking-table">
        <thead>
          <tr>
            <th className="estimate-column-scope estimate-sticky estimate-sticky-scope">Scope</th>
            <th className="estimate-column-bucket">Labor</th>
            <th className="estimate-column-bucket">Materials</th>
            <th className="estimate-column-bucket">Equipment</th>
            <th className="estimate-column-bucket">Subs</th>
            <th className="estimate-column-bucket">O/H + Profit</th>
            <th className="estimate-column-total">Actual</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(({ item, sectionKey, showSectionHeading }) => {
            const key = item.project_estimate_item_id ?? item.item_code ?? ''
            const derived = derivedByKey[key]
            const sectionTotal = sectionTotals.get(sectionKey)
            if (!derived) {
              return null
            }

            return (
              <Fragment key={key}>
                {showSectionHeading ? (
                  <tr className="estimate-section-row" key={`${sectionKey}-heading`}>
                    <td colSpan={7}>
                      <div>
                        <span>
                          {item.section_code} · {item.section_name}
                        </span>
                        <strong>
                          {formatCurrency(sectionTotal?.actual)} actual · {formatCurrency(sectionTotal?.bid)} bid
                        </strong>
                      </div>
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className="scope-cell estimate-column-scope estimate-sticky estimate-sticky-scope">
                    <div className="scope-editor scope-editor-readonly">
                      <div className="scope-editor-top">
                        <span className="scope-code-pill mono">{item.item_code}</span>
                      </div>
                      <strong>{item.item_name}</strong>
                    </div>
                  </td>
                  <td className="estimate-column-bucket">
                    {renderBucketButton('labor', key, item, derived)}
                  </td>
                  <td className="estimate-column-bucket">
                    {renderBucketButton('materials', key, item, derived)}
                  </td>
                  <td className="estimate-column-bucket">
                    {renderBucketButton('equipment', key, item, derived)}
                  </td>
                  <td className="estimate-column-bucket">
                    {renderBucketButton('subcontract', key, item, derived)}
                  </td>
                  <td className="estimate-column-bucket">
                    {renderBucketButton('markup', key, item, derived)}
                  </td>
                  <td className="estimate-column-total estimate-total-cell">
                    <div className="estimate-total-stack">
                      <strong>{formatCurrency(derived.actual_total_cost)}</strong>
                      <span className="estimate-reference">
                        Bid {formatCurrency(item.estimated_total_cost)}
                      </span>
                      {!readOnly ? (
                        <span className={`row-save-state row-save-${rowSaveState[key] ?? 'saved'}`}>
                          {getSaveLabel(key)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {openBucket ? (
        <TrackingBucketPanel
          draft={drafts[openBucket.itemId]}
          employeeLibrary={employeeLibrary}
          equipmentLibrary={equipmentLibrary}
          item={itemsByKey.get(openBucket.itemId)!}
          materialLibrary={materialLibrary}
          onClose={handleCloseBucket}
          onCommit={() => {
            const activeItem = itemsByKey.get(openBucket.itemId)
            const activeDraft = drafts[openBucket.itemId]

            if (activeItem && activeDraft) {
              flushAutoSave(openBucket.itemId, activeDraft, activeItem)
            }
          }}
          onCreateEmployeeLibraryItem={onCreateEmployeeLibraryItem}
          onCreateEquipmentLibraryItem={onCreateEquipmentLibraryItem}
          onCreateMaterialLibraryItem={onCreateMaterialLibraryItem}
          onUpdateDraft={(patch, persistImmediately) => {
            updateDraft(openBucket.itemId, patch, persistImmediately)
          }}
          type={openBucket.bucket}
        />
      ) : null}
    </div>
  )
}
