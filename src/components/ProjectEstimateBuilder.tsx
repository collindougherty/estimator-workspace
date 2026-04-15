import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { buildUnitOptions } from '../lib/item-detail'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectEstimateItemUpdate,
  ProjectItemMetric,
} from '../lib/models'
import {
  calculateEstimateBuilderDerived,
  isEstimateBuilderDraftDirty,
  toEstimateBuilderDraft,
  toProjectEstimateItemPatch,
  type EstimateBuilderDraft,
  type EstimateBuilderDerived,
} from '../lib/project-estimate-builder'
import { formatCurrency, formatNumber } from '../lib/formatters'
import {
  createEquipmentBreakdownEntry,
  createEquipmentBreakdownEntryFromEquipment,
  createLaborBreakdownEntry,
  createLaborBreakdownEntryFromEmployee,
  createMaterialBreakdownEntry,
  createMaterialBreakdownEntryFromMaterial,
} from '../lib/resource-breakdowns'
import { BucketControlButton } from './BucketControlButton'
import { FloatingPanel } from './FloatingPanel'
import {
  EquipmentBreakdownFields,
  LaborBreakdownFields,
  MaterialBreakdownFields,
} from './ResourceBreakdownFields'

type BucketKey = 'equipment' | 'labor' | 'materials' | 'markup' | 'subcontract'
type PickerState = {
  bucket: BucketKey
  itemId: string
}

type SectionGroup = {
  estimatedTotal: number
  includedCount: number
  items: ProjectItemMetric[]
  key: string
  sectionCode: string
  sectionName: string
}

type ScopeCreateTarget =
  | {
      mode: 'existing-section'
      sectionCode: string
      sectionName: string
    }
  | {
      mode: 'new-section'
    }

type ProjectEstimateBuilderProps = {
  employeeLibrary: OrganizationEmployeeLibraryItem[]
  equipmentLibrary: OrganizationEquipmentLibraryItem[]
  isScopeMutating?: boolean
  items: ProjectItemMetric[]
  materialLibrary: OrganizationMaterialLibraryItem[]
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
  onCreateScope: (draft: {
    itemName: string
    sectionCode?: string
    sectionName: string
    unit: string
  }) => Promise<void>
  onDeleteScope: (item: ProjectItemMetric) => Promise<void>
  onSaveRow: (itemId: string, patch: ProjectEstimateItemUpdate) => Promise<void>
  readOnly?: boolean
}

const getItemKey = (item: ProjectItemMetric) => item.project_estimate_item_id ?? item.item_code ?? ''

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

const getEstimateBucketTotal = (bucket: BucketKey, derived: EstimateBuilderDerived) => {
  if (bucket === 'labor') {
    return derived.laborCost
  }

  if (bucket === 'equipment') {
    return derived.equipmentCost
  }

  if (bucket === 'subcontract') {
    return derived.subcontractCost
  }

  if (bucket === 'markup') {
    return derived.overheadCost + derived.profitCost
  }

  return derived.materialCost
}

const getEstimateBucketSummary = (
  bucket: BucketKey,
  draft: EstimateBuilderDraft,
  derived: EstimateBuilderDerived,
) => {
  if (bucket === 'labor') {
    return `${formatNumber(derived.laborHours)} hrs · ${formatCurrency(derived.laborRate)} / hr`
  }

  if (bucket === 'equipment') {
    return `${formatNumber(derived.equipmentDays)} days · ${formatCurrency(derived.equipmentRate)} / day`
  }

  if (bucket === 'subcontract') {
    return derived.subcontractCost > 0 ? 'Flat subcontract allowance' : 'Tap to add subcontract cost'
  }

  if (bucket === 'markup') {
    return `${formatNumber(derived.overheadPercent)}% O/H · ${formatNumber(derived.profitPercent)}% profit`
  }

  if (derived.quantity > 0) {
    return `${formatNumber(derived.quantity)} ${draft.unit} · ${formatCurrency(derived.materialCostPerUnit)} / unit`
  }

  if (derived.materialCost > 0) {
    return 'Material total loaded'
  }

  return `${formatNumber(derived.quantity)} ${draft.unit} · ${formatCurrency(derived.materialCostPerUnit)} / unit`
}

const getEstimateBucketDetail = (bucket: BucketKey, derived: EstimateBuilderDerived) => {
  if (bucket === 'markup') {
    return `${formatCurrency(derived.directCost)} direct cost`
  }

  return undefined
}

const buildSectionGroups = (
  items: ProjectItemMetric[],
  drafts: Record<string, EstimateBuilderDraft>,
  derivedByKey: Record<string, EstimateBuilderDerived>,
) => {
  const groups = new Map<string, SectionGroup>()

  for (const item of items) {
    const key = getItemKey(item)
    const draft = drafts[key]
    const derived = derivedByKey[key]
    const sectionCode = item.section_code ?? '—'
    const sectionName = item.section_name ?? 'Unassigned scope'
    const sectionKey = sectionCode + ':' + sectionName
    const existingGroup = groups.get(sectionKey)

    if (!draft || !derived) {
      continue
    }

    if (!existingGroup) {
      groups.set(sectionKey, {
        estimatedTotal: draft.isIncluded ? derived.totalCost : 0,
        includedCount: draft.isIncluded ? 1 : 0,
        items: [item],
        key: sectionKey,
        sectionCode,
        sectionName,
      })
      continue
    }

    existingGroup.items.push(item)
    existingGroup.estimatedTotal += draft.isIncluded ? derived.totalCost : 0
    existingGroup.includedCount += draft.isIncluded ? 1 : 0
  }

  return Array.from(groups.values())
}

const ResourcePickerPanel = ({
  draft,
  onClose,
  onUnitChange,
  onUpdateDraft,
  type,
  unitOptions,
  employees,
  equipment,
  materials,
  item,
  onCreateEmployeeLibraryItem,
  onCreateEquipmentLibraryItem,
  onCreateMaterialLibraryItem,
}: {
  draft: EstimateBuilderDraft
  employees: OrganizationEmployeeLibraryItem[]
  equipment: OrganizationEquipmentLibraryItem[]
  item: ProjectItemMetric
  materials: OrganizationMaterialLibraryItem[]
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
  onClose: () => void
  onUnitChange: (value: string) => void
  onUpdateDraft: (patch: Partial<EstimateBuilderDraft>, persistImmediately?: boolean) => void
  type: BucketKey
  unitOptions: string[]
}) => {
  const [searchValue, setSearchValue] = useState('')
  const derived = useMemo(() => calculateEstimateBuilderDerived(draft), [draft])
  const searchNeedle = searchValue.trim().toLowerCase()

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        if (!searchNeedle) {
          return true
        }

        return (employee.name + ' ' + (employee.role ?? '')).toLowerCase().includes(searchNeedle)
      }),
    [employees, searchNeedle],
  )

  const filteredEquipment = useMemo(
    () =>
      equipment.filter((equipmentItem) => {
        if (!searchNeedle) {
          return true
        }

        return equipmentItem.name.toLowerCase().includes(searchNeedle)
      }),
    [equipment, searchNeedle],
  )

  const filteredMaterials = useMemo(
    () =>
      materials.filter((material) => {
        if (!searchNeedle) {
          return true
        }

        return (material.name + ' ' + material.unit).toLowerCase().includes(searchNeedle)
      }),
    [materials, searchNeedle],
  )

  const bucketLabel = getBucketLabel(type)
  const isLibraryBucket = type === 'labor' || type === 'equipment' || type === 'materials'
  const title =
    type === 'subcontract'
      ? 'Subcontract editor'
      : type === 'markup'
        ? 'O/H + profit editor'
        : bucketLabel + ' editor'
  const subtitle =
    type === 'subcontract'
      ? 'Set the subcontract allowance for ' + (item.item_name ?? 'this item') + '.'
      : type === 'markup'
        ? 'Set overhead and profit for ' + (item.item_name ?? 'this item') + '.'
        : 'Edit the ' + bucketLabel.toLowerCase() + ' mix for ' + (item.item_name ?? 'this item') + '.'
  const bucketTotal = getEstimateBucketTotal(type, derived)
  const updateLaborBreakdown = (nextEntries: EstimateBuilderDraft['laborBreakdown']) => {
    onUpdateDraft({ laborBreakdown: nextEntries })
  }
  const updateMaterialBreakdown = (
    nextEntries: EstimateBuilderDraft['materialBreakdown'],
  ) => {
    onUpdateDraft({ materialBreakdown: nextEntries })
  }
  const updateEquipmentBreakdown = (
    nextEntries: EstimateBuilderDraft['equipmentBreakdown'],
  ) => {
    onUpdateDraft({ equipmentBreakdown: nextEntries })
  }

  return (
    <FloatingPanel
      className={isLibraryBucket ? 'floating-panel-resource-sheet' : undefined}
      onClose={onClose}
      size={isLibraryBucket ? 'wide' : 'compact'}
      title={title}
      subtitle={subtitle}
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
                <span>{bucketLabel} total</span>
                <strong>{formatCurrency(bucketTotal)}</strong>
              </div>
            </div>

            <div className="resource-sheet-column-body resource-sheet-editor-body">
              {type === 'materials' ? (
                <>
                  <div className="resource-sheet-form-grid">
                    <label className="resource-sheet-field">
                      <span>Quantity</span>
                      <input
                        aria-label={(item.item_name ?? 'Scope item') + ' quantity'}
                        min="0"
                        onBlur={() => onUpdateDraft({}, true)}
                        onChange={(event) => onUpdateDraft({ quantity: event.target.value })}
                        step="0.1"
                        type="number"
                        value={draft.quantity}
                      />
                    </label>
                    <label className="resource-sheet-field">
                      <span>Unit of measure</span>
                      <select
                        className="item-detail-select"
                        onChange={(event) => onUnitChange(event.target.value)}
                        value={draft.unit}
                      >
                        {unitOptions.map((unitOption) => (
                          <option key={unitOption} value={unitOption}>
                            {unitOption}
                          </option>
                        ))}
                        <option value="__add__">+ Add UoM</option>
                      </select>
                    </label>
                  </div>
                  <div className="resource-sheet-readout resource-sheet-readout-soft">
                    <span>Selected materials</span>
                    <strong>{formatCurrency(derived.materialCost)}</strong>
                    <small>
                      {formatNumber(derived.quantity)} {draft.unit} scope quantity
                    </small>
                  </div>
                  <MaterialBreakdownFields
                    materials={materials}
                    entries={draft.materialBreakdown}
                    onAddManual={() => {
                      updateMaterialBreakdown([
                        ...draft.materialBreakdown,
                        createMaterialBreakdownEntry({ unit: draft.unit }),
                      ])
                    }}
                    onCreateLibraryItem={onCreateMaterialLibraryItem}
                    onRemove={(entryId) => {
                      updateMaterialBreakdown(
                        draft.materialBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.materialBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft(
                        { materialBreakdown: nextEntries },
                        persistImmediately,
                      )
                    }}
                  />
                </>
              ) : null}

              {type === 'labor' ? (
                <>
                  <div className="resource-sheet-readout resource-sheet-readout-soft">
                    <span>Crew total</span>
                    <strong>{formatCurrency(derived.laborCost)}</strong>
                    <small>
                      {formatNumber(derived.laborHours)} hrs · {formatCurrency(derived.laborRate)} / hr blended
                    </small>
                  </div>
                  <LaborBreakdownFields
                    employees={employees}
                    entries={draft.laborBreakdown}
                    onAddManual={() => {
                      updateLaborBreakdown([...draft.laborBreakdown, createLaborBreakdownEntry()])
                    }}
                    onCreateLibraryItem={onCreateEmployeeLibraryItem}
                    onRemove={(entryId) => {
                      updateLaborBreakdown(
                        draft.laborBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.laborBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft({ laborBreakdown: nextEntries }, persistImmediately)
                    }}
                  />
                </>
              ) : null}

              {type === 'equipment' ? (
                <>
                  <div className="resource-sheet-readout resource-sheet-readout-soft">
                    <span>Equipment total</span>
                    <strong>{formatCurrency(derived.equipmentCost)}</strong>
                    <small>
                      {formatNumber(derived.equipmentDays)} days · {formatCurrency(derived.equipmentRate)} / day blended
                    </small>
                  </div>
                  <EquipmentBreakdownFields
                    equipment={equipment}
                    entries={draft.equipmentBreakdown}
                    onAddManual={() => {
                      updateEquipmentBreakdown([
                        ...draft.equipmentBreakdown,
                        createEquipmentBreakdownEntry(),
                      ])
                    }}
                    onCreateLibraryItem={onCreateEquipmentLibraryItem}
                    onRemove={(entryId) => {
                      updateEquipmentBreakdown(
                        draft.equipmentBreakdown.filter((entry) => entry.id !== entryId),
                      )
                    }}
                    onUpdate={(entryId, patch, persistImmediately) => {
                      const nextEntries = draft.equipmentBreakdown.map((entry) =>
                        entry.id === entryId ? { ...entry, ...patch } : entry,
                      )
                      onUpdateDraft(
                        { equipmentBreakdown: nextEntries },
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
                  placeholder={'Search ' + bucketLabel.toLowerCase() + ' prefills'}
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
                            ...draft.laborBreakdown,
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
                            ...draft.equipmentBreakdown,
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
                            ...draft.materialBreakdown,
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
              <span>{bucketLabel} total</span>
              <strong>{formatCurrency(bucketTotal)}</strong>
            </div>
          </div>

          {type === 'subcontract' ? (
            <div className="resource-sheet-form">
              <label className="resource-sheet-field">
                <span>Subcontract cost</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' subcontract cost'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ subcontractCost: event.target.value })}
                  step="0.01"
                  type="number"
                  value={draft.subcontractCost}
                />
              </label>
              <div className="resource-sheet-readout resource-sheet-readout-soft">
                <span>Current allowance</span>
                <strong>{formatCurrency(derived.subcontractCost)}</strong>
                <small>Flat subcontract cost for this scope</small>
              </div>
            </div>
          ) : null}

          {type === 'markup' ? (
            <div className="resource-sheet-form resource-sheet-form-grid">
              <label className="resource-sheet-field">
                <span>O/H %</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' overhead percent'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ overheadPercent: event.target.value })}
                  step="1"
                  type="number"
                  value={draft.overheadPercent}
                />
              </label>
              <label className="resource-sheet-field">
                <span>Profit %</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' profit percent'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ profitPercent: event.target.value })}
                  step="1"
                  type="number"
                  value={draft.profitPercent}
                />
              </label>
              <div className="resource-sheet-readout resource-sheet-readout-soft">
                <span>Markup on direct cost</span>
                <strong>{formatCurrency(derived.overheadCost + derived.profitCost)}</strong>
                <small>{formatCurrency(derived.directCost)} base direct cost</small>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </FloatingPanel>
  )
}

const ScopeCreatePopover = ({
  disabled = false,
  onClose,
  onSubmit,
  target,
  unitOptions,
}: {
  disabled?: boolean
  onClose: () => void
  onSubmit: (draft: {
    itemName: string
    sectionCode?: string
    sectionName: string
    unit: string
  }) => Promise<void>
  target: ScopeCreateTarget
  unitOptions: string[]
}) => {
  const isNewSection = target.mode === 'new-section'
  const [itemName, setItemName] = useState('')
  const [sectionName, setSectionName] = useState(isNewSection ? '' : target.sectionName)
  const [unit, setUnit] = useState(unitOptions[0] ?? 'EA')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!itemName.trim()) {
      return
    }

    if (isNewSection && !sectionName.trim()) {
      return
    }

    await onSubmit({
      itemName: itemName.trim(),
      sectionCode: isNewSection ? undefined : target.sectionCode,
      sectionName: isNewSection ? sectionName.trim() : target.sectionName,
      unit,
    })
  }

  return (
    <div className="scope-picker-popover">
      <div className="scope-picker-header">
        <div>
          <h3>{isNewSection ? 'New section' : 'Add scope'}</h3>
          <p>
            {isNewSection
              ? 'Create a new section and its first scope inline.'
              : `${target.sectionCode} · ${target.sectionName}`}
          </p>
        </div>
      </div>

      <form
        className="scope-picker-form"
        onSubmit={(event) => {
          void handleSubmit(event).catch(() => undefined)
        }}
      >
        {isNewSection ? (
          <label>
            <span>Section</span>
            <input
              autoFocus
              disabled={disabled}
              onChange={(event) => setSectionName(event.target.value)}
              placeholder="Roof replacement"
              required
              type="text"
              value={sectionName}
            />
          </label>
        ) : null}
        <label>
          <span>Scope</span>
          <input
            autoFocus={!isNewSection}
            disabled={disabled}
            onChange={(event) => setItemName(event.target.value)}
            placeholder="Tear off and disposal"
            required
            type="text"
            value={itemName}
          />
        </label>
        <label>
          <span>Unit</span>
          <select
            className="item-detail-select"
            disabled={disabled}
            onChange={(event) => setUnit(event.target.value)}
            value={unit}
          >
            {unitOptions.map((unitOption) => (
              <option key={unitOption} value={unitOption}>
                {unitOption}
              </option>
            ))}
          </select>
        </label>
        <div className="scope-picker-actions">
          <button className="ghost-button" disabled={disabled} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={disabled} type="submit">
            {isNewSection ? 'Add section' : 'Add scope'}
          </button>
        </div>
      </form>
    </div>
  )
}

export const ProjectEstimateBuilder = ({
  employeeLibrary,
  equipmentLibrary,
  isScopeMutating = false,
  items,
  materialLibrary,
  onCreateEmployeeLibraryItem,
  onCreateEquipmentLibraryItem,
  onCreateMaterialLibraryItem,
  onCreateScope,
  onDeleteScope,
  onSaveRow,
  readOnly = false,
}: ProjectEstimateBuilderProps) => {
  const [customUnits, setCustomUnits] = useState<string[]>([])
  const [draftOverrides, setDraftOverrides] = useState<Record<string, EstimateBuilderDraft>>({})
  const [openPicker, setOpenPicker] = useState<PickerState | null>(null)
  const [scopeCreator, setScopeCreator] = useState<ScopeCreateTarget | null>(null)
  const [rowSaveState, setRowSaveState] = useState<Record<string, 'error' | 'pending' | 'saved' | 'saving'>>({})
  const saveTimeouts = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})

  useEffect(
    () => () => {
      Object.values(saveTimeouts.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
    },
    [],
  )

  const itemsByKey = useMemo(() => new Map(items.map((item) => [getItemKey(item), item])), [items])

  const drafts = useMemo(
    () =>
      Object.fromEntries(
        items.map((item) => {
          const key = getItemKey(item)
          return [key, draftOverrides[key] ?? toEstimateBuilderDraft(item)]
        }),
      ),
    [draftOverrides, items],
  )

  const derivedByKey = useMemo(
    () =>
      Object.fromEntries(
        items.map((item) => {
          const key = getItemKey(item)
          return [key, calculateEstimateBuilderDerived(drafts[key])]
        }),
      ),
    [drafts, items],
  )

  const sectionGroups = useMemo(
    () => buildSectionGroups(items, drafts, derivedByKey),
    [drafts, derivedByKey, items],
  )
  const scopeUnitOptions = useMemo(
    () =>
      buildUnitOptions(
        'EA',
        items
          .map((item) => item.unit?.trim().toUpperCase())
          .filter((unit): unit is string => Boolean(unit))
          .concat(customUnits),
      ),
    [customUnits, items],
  )

  const persistDraft = async (key: string, draft: EstimateBuilderDraft) => {
    if (readOnly) {
      return
    }

    const item = itemsByKey.get(key)

    if (item && !isEstimateBuilderDraftDirty(draft, item)) {
      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
      return
    }

    if (draft.itemName.trim() === '') {
      setRowSaveState((current) => ({ ...current, [key]: 'error' }))
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'saving' }))

    try {
      await onSaveRow(key, toProjectEstimateItemPatch(draft))
      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
    } catch {
      setRowSaveState((current) => ({ ...current, [key]: 'error' }))
    }
  }

  const queueAutoSave = (key: string, draft: EstimateBuilderDraft) => {
    if (readOnly) {
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'pending' }))
    window.clearTimeout(saveTimeouts.current[key])
    saveTimeouts.current[key] = window.setTimeout(() => {
      void persistDraft(key, draft)
    }, 900)
  }

  const flushAutoSave = (key: string, draft: EstimateBuilderDraft) => {
    if (readOnly) {
      return
    }

    window.clearTimeout(saveTimeouts.current[key])
    void persistDraft(key, draft)
  }

  const updateDraft = (
    key: string,
    patch: Partial<EstimateBuilderDraft>,
    persistImmediately = false,
  ) => {
    const item = itemsByKey.get(key)
    let nextDraft: EstimateBuilderDraft | null = null

    setDraftOverrides((current) => {
      const currentDraft = current[key] ?? (item ? toEstimateBuilderDraft(item) : null)

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
      flushAutoSave(key, nextDraft)
      return
    }

    queueAutoSave(key, nextDraft)
  }

  const handleUnitChange = (key: string, value: string) => {
    if (value === '__add__') {
      const nextUnit = window.prompt('Add a unit of measure', '')
      const normalizedUnit = nextUnit?.trim().toUpperCase()

      if (!normalizedUnit) {
        return
      }

      setCustomUnits((current) => (current.includes(normalizedUnit) ? current : [...current, normalizedUnit]))
      updateDraft(key, { unit: normalizedUnit }, true)
      return
    }

    updateDraft(key, { unit: value }, true)
  }

  const handleClosePicker = () => {
    if (openPicker) {
      const item = itemsByKey.get(openPicker.itemId)
      const draft = drafts[openPicker.itemId]

      if (item && draft) {
        flushAutoSave(openPicker.itemId, draft)
      }
    }

    setOpenPicker(null)
  }

  const handleCreateScope = async (draft: {
    itemName: string
    sectionCode?: string
    sectionName: string
    unit: string
  }) => {
    await onCreateScope(draft)
    setScopeCreator(null)
  }

  const getSaveLabel = (key: string) => {
    if (rowSaveState[key] === 'error') {
      return 'Needs retry'
    }

    if (rowSaveState[key] === 'pending' || rowSaveState[key] === 'saving') {
      return 'Syncing…'
    }

    return readOnly ? 'Read-only' : 'Synced'
  }

  const activeItem = openPicker ? itemsByKey.get(openPicker.itemId) ?? null : null
  const activeDraft = openPicker ? drafts[openPicker.itemId] ?? null : null
  const scopeCreatorKey =
    scopeCreator?.mode === 'existing-section' ? scopeCreator.sectionCode : scopeCreator?.mode ?? null

  const renderBucketButton = (
    bucket: BucketKey,
    key: string,
    draft: EstimateBuilderDraft,
    derived: EstimateBuilderDerived,
    showLabel = false,
  ) => {
    const isCompactMarkup = !showLabel && bucket === 'markup'
    const summary = isCompactMarkup
      ? `${formatNumber(derived.overheadPercent)}% O/H · ${formatNumber(derived.profitPercent)}% P`
      : getEstimateBucketSummary(bucket, draft, derived)

    return (
      <BucketControlButton
        amount={formatCurrency(getEstimateBucketTotal(bucket, derived))}
        ariaLabel={`${draft.itemName || 'Scope item'} ${getBucketLabel(bucket)}`}
        className={showLabel ? undefined : 'bucket-control-button-compact'}
        detail={isCompactMarkup ? undefined : getEstimateBucketDetail(bucket, derived)}
        disabled={readOnly}
        label={showLabel ? getBucketLabel(bucket) : undefined}
        onClick={() => setOpenPicker({ bucket, itemId: key })}
        summary={summary}
      />
    )
  }

  const renderBucketGrid = (
    key: string,
    draft: EstimateBuilderDraft,
    derived: EstimateBuilderDerived,
    showLabels = true,
  ) => (
    <div className="project-builder-bucket-grid">
      {renderBucketButton('materials', key, draft, derived, showLabels)}
      {renderBucketButton('labor', key, draft, derived, showLabels)}
      {renderBucketButton('equipment', key, draft, derived, showLabels)}
      {renderBucketButton('subcontract', key, draft, derived, showLabels)}
      {renderBucketButton('markup', key, draft, derived, showLabels)}
    </div>
  )

  return (
    <div className="project-builder-table-layout">
      {!readOnly ? (
        <div className="project-builder-toolbar">
          <div className="scope-picker">
            <button
              className="secondary-button project-builder-toolbar-button"
              disabled={isScopeMutating}
              onClick={() =>
                setScopeCreator((current) => (current?.mode === 'new-section' ? null : { mode: 'new-section' }))
              }
              type="button"
            >
              New section
            </button>
            {scopeCreator?.mode === 'new-section' ? (
              <ScopeCreatePopover
                key={scopeCreatorKey ?? 'new-section'}
                disabled={isScopeMutating}
                onClose={() => setScopeCreator(null)}
                onSubmit={handleCreateScope}
                target={scopeCreator}
                unitOptions={scopeUnitOptions}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {sectionGroups.length === 0 ? (
        <div className="panel-empty">No scopes yet. Add a section to start building the bid.</div>
      ) : (
        <>
          <div className="table-shell project-builder-table-shell project-builder-desktop-list">
            <table className="estimate-table project-builder-table">
              <thead>
                <tr>
                  <th className="estimate-column-scope estimate-sticky">Scope</th>
                  <th className="estimate-column-bucket">Labor</th>
                  <th className="estimate-column-bucket">Materials</th>
                  <th className="estimate-column-bucket">Equipment</th>
                  <th className="estimate-column-bucket">Subs</th>
                  <th className="estimate-column-bucket">O/H + Profit</th>
                  <th className="estimate-column-total">Total</th>
                </tr>
              </thead>
              <tbody>
                {sectionGroups.map((section) => (
                  <Fragment key={section.key}>
                    <tr className="estimate-section-row">
                      <td colSpan={7}>
                        <div className="estimate-section-heading">
                          <span>
                            {section.sectionCode} · {section.sectionName}
                          </span>
                          <div className="estimate-section-heading-actions">
                            {!readOnly ? (
                              <div className="scope-picker">
                                <button
                                  className="ghost-button scope-row-action"
                                  disabled={isScopeMutating}
                                  onClick={() =>
                                    setScopeCreator((current) =>
                                      current?.mode === 'existing-section' &&
                                      current.sectionCode === section.sectionCode
                                        ? null
                                        : {
                                            mode: 'existing-section',
                                            sectionCode: section.sectionCode,
                                            sectionName: section.sectionName,
                                          },
                                    )
                                  }
                                  type="button"
                                >
                                  + Scope
                                </button>
                                {scopeCreator?.mode === 'existing-section' &&
                                scopeCreator.sectionCode === section.sectionCode ? (
                                  <ScopeCreatePopover
                                    key={scopeCreatorKey ?? section.sectionCode}
                                    disabled={isScopeMutating}
                                    onClose={() => setScopeCreator(null)}
                                    onSubmit={handleCreateScope}
                                    target={scopeCreator}
                                    unitOptions={scopeUnitOptions}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                            <strong>{formatCurrency(section.estimatedTotal)}</strong>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {section.items.map((item) => {
                      const key = getItemKey(item)
                      const draft = drafts[key]
                      const derived = derivedByKey[key]
                      return (
                        <tr className={draft.isIncluded ? '' : 'estimate-row-muted'} key={key}>
                          <td className="estimate-column-scope estimate-sticky">
                            <div className={`scope-editor${readOnly ? ' scope-editor-readonly' : ''}`}>
                              <div className="scope-editor-top">
                                {!readOnly ? (
                                  <input
                                    aria-label={'Toggle ' + (draft.itemName || 'scope item')}
                                    checked={draft.isIncluded}
                                    onChange={(event) => {
                                      updateDraft(key, { isIncluded: event.target.checked }, true)
                                    }}
                                    type="checkbox"
                                  />
                                ) : null}
                                <span className="scope-code-pill mono">{item.item_code}</span>
                                {!readOnly ? (
                                  <button
                                    className="ghost-button scope-row-action scope-row-action-delete"
                                    disabled={isScopeMutating}
                                    onClick={() => {
                                      void onDeleteScope(item)
                                    }}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>
                              {readOnly ? (
                                <strong>{draft.itemName}</strong>
                              ) : (
                                <input
                                  aria-label={(item.item_code ?? 'Scope') + ' scope name'}
                                  className="scope-name-input"
                                  onBlur={() => flushAutoSave(key, draft)}
                                  onChange={(event) => updateDraft(key, { itemName: event.target.value })}
                                  type="text"
                                  value={draft.itemName}
                                />
                              )}
                            </div>
                          </td>
                          <td className="estimate-column-bucket">
                            {renderBucketButton('labor', key, draft, derived)}
                          </td>
                          <td className="estimate-column-bucket">
                            {renderBucketButton('materials', key, draft, derived)}
                          </td>
                          <td className="estimate-column-bucket">
                            {renderBucketButton('equipment', key, draft, derived)}
                          </td>
                          <td className="estimate-column-bucket">
                            {renderBucketButton('subcontract', key, draft, derived)}
                          </td>
                          <td className="estimate-column-bucket">
                            {renderBucketButton('markup', key, draft, derived)}
                          </td>
                          <td className="estimate-column-total estimate-total-cell">
                            <div className="estimate-total-stack">
                              <strong>{formatCurrency(derived.totalCost)}</strong>
                              <span className={'row-save-state row-save-' + (rowSaveState[key] ?? 'saved')}>
                                {getSaveLabel(key)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="project-builder-mobile-list">
            {sectionGroups.map((section) => (
              <section className="project-builder-section" key={section.key}>
                <div className="project-builder-section-header">
                  <div>
                    <span className="eyebrow">{section.sectionCode}</span>
                    <h3>{section.sectionName}</h3>
                    <p className="panel-meta">
                      {section.includedCount} included · {section.items.length} terminal items
                    </p>
                  </div>
                  <div className="project-builder-section-actions">
                    <div className="project-builder-section-total">
                      <span>Section estimate</span>
                      <strong>{formatCurrency(section.estimatedTotal)}</strong>
                    </div>
                    {!readOnly ? (
                      <div className="scope-picker">
                        <button
                          className="ghost-button scope-row-action"
                          disabled={isScopeMutating}
                          onClick={() =>
                            setScopeCreator((current) =>
                              current?.mode === 'existing-section' &&
                              current.sectionCode === section.sectionCode
                                ? null
                                : {
                                    mode: 'existing-section',
                                    sectionCode: section.sectionCode,
                                    sectionName: section.sectionName,
                                  },
                            )
                          }
                          type="button"
                        >
                          + Scope
                        </button>
                        {scopeCreator?.mode === 'existing-section' &&
                        scopeCreator.sectionCode === section.sectionCode ? (
                          <ScopeCreatePopover
                            key={scopeCreatorKey ?? section.sectionCode}
                            disabled={isScopeMutating}
                            onClose={() => setScopeCreator(null)}
                            onSubmit={handleCreateScope}
                            target={scopeCreator}
                            unitOptions={scopeUnitOptions}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {section.items.map((item) => {
                  const key = getItemKey(item)
                  const draft = drafts[key]
                  const derived = derivedByKey[key]
                  return (
                    <details
                      className={'worksheet-mobile-card' + (draft.isIncluded ? '' : ' worksheet-mobile-card-muted')}
                      key={key}
                    >
                      <summary className="worksheet-mobile-card-summary">
                        <div className="worksheet-mobile-card-summary-main">
                          <div className="worksheet-mobile-card-tags">
                            <span className="scope-code-pill mono">{item.item_code}</span>
                            {!draft.isIncluded ? (
                              <span className="worksheet-mobile-flag">Excluded</span>
                            ) : null}
                          </div>
                          <strong>{draft.itemName}</strong>
                          <small className="project-builder-mobile-summary-line">
                            M {formatCurrency(derived.materialCost)} · L {formatCurrency(derived.laborCost)} · E{' '}
                            {formatCurrency(derived.equipmentCost)}
                          </small>
                        </div>
                        <div className="worksheet-mobile-card-total">
                          <span>Total</span>
                          <strong>{formatCurrency(derived.totalCost)}</strong>
                          <small className={'row-save-state row-save-' + (rowSaveState[key] ?? 'saved')}>
                            {getSaveLabel(key)}
                          </small>
                        </div>
                      </summary>
                      <div className="worksheet-mobile-card-body project-builder-mobile-card-body">
                        {!readOnly ? (
                          <label className="worksheet-mobile-toggle">
                            <span>Include in proposal</span>
                            <input
                              aria-label={'Toggle ' + (draft.itemName || 'scope item')}
                              checked={draft.isIncluded}
                              onChange={(event) => {
                                updateDraft(key, { isIncluded: event.target.checked }, true)
                              }}
                              type="checkbox"
                            />
                          </label>
                        ) : (
                          <div className="worksheet-mobile-readonly-row">
                            <span>Status</span>
                            <strong>{draft.isIncluded ? 'Included' : 'Excluded'}</strong>
                          </div>
                        )}

                        {!readOnly ? (
                          <>
                            <label className="project-builder-field">
                              <span>Scope</span>
                              <input
                                aria-label={(item.item_code ?? 'Scope') + ' scope name'}
                                onBlur={() => flushAutoSave(key, draft)}
                                onChange={(event) => updateDraft(key, { itemName: event.target.value })}
                                type="text"
                                value={draft.itemName}
                              />
                            </label>
                            <div className="project-builder-row-actions">
                              <button
                                className="ghost-button scope-row-action scope-row-action-delete"
                                disabled={isScopeMutating}
                                onClick={() => {
                                  void onDeleteScope(item)
                                }}
                                type="button"
                              >
                                Delete scope
                              </button>
                            </div>
                          </>
                        ) : null}

                        {renderBucketGrid(key, draft, derived, true)}
                      </div>
                    </details>
                  )
                })}
              </section>
            ))}
          </div>
        </>
      )}

      {activeItem && activeDraft && openPicker ? (
        <ResourcePickerPanel
          draft={activeDraft}
          employees={employeeLibrary}
          equipment={equipmentLibrary}
          item={activeItem}
          materials={materialLibrary}
          onCreateEmployeeLibraryItem={onCreateEmployeeLibraryItem}
          onCreateEquipmentLibraryItem={onCreateEquipmentLibraryItem}
          onCreateMaterialLibraryItem={onCreateMaterialLibraryItem}
          onClose={handleClosePicker}
          onUnitChange={(value) => handleUnitChange(openPicker.itemId, value)}
          onUpdateDraft={(patch, persistImmediately) => updateDraft(openPicker.itemId, patch, persistImmediately)}
          type={openPicker.bucket}
          unitOptions={buildUnitOptions(activeDraft.unit, customUnits)}
        />
      ) : null}
    </div>
  )
}
