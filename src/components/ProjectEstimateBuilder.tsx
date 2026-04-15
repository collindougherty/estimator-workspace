import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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
  toEstimateBuilderDraft,
  toProjectEstimateItemPatch,
  type EstimateBuilderDraft,
  type EstimateBuilderDerived,
} from '../lib/project-estimate-builder'
import { formatCurrency, formatNumber } from '../lib/formatters'
import { FloatingPanel } from './FloatingPanel'

type BucketKey = 'equipment' | 'labor' | 'materials'
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

type ProjectEstimateBuilderProps = {
  employeeLibrary: OrganizationEmployeeLibraryItem[]
  equipmentLibrary: OrganizationEquipmentLibraryItem[]
  items: ProjectItemMetric[]
  materialLibrary: OrganizationMaterialLibraryItem[]
  onManageLibrary: () => void
  onSaveRow: (itemId: string, patch: ProjectEstimateItemUpdate) => Promise<void>
  projectId: string
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

  return 'Materials'
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
        estimatedTotal: derived.totalCost,
        includedCount: draft.isIncluded ? 1 : 0,
        items: [item],
        key: sectionKey,
        sectionCode,
        sectionName,
      })
      continue
    }

    existingGroup.items.push(item)
    existingGroup.estimatedTotal += derived.totalCost
    existingGroup.includedCount += draft.isIncluded ? 1 : 0
  }

  return Array.from(groups.values())
}

const BucketButton = ({
  amount,
  disabled,
  label,
  onClick,
  summary,
}: {
  amount: string
  disabled: boolean
  label: string
  onClick: () => void
  summary: string
}) => (
  <button
    className="project-builder-bucket-button"
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    <div className="project-builder-bucket-button-head">
      <span>{label}</span>
      <strong>{amount}</strong>
    </div>
    <small>{summary}</small>
  </button>
)

const ResourcePickerPanel = ({
  draft,
  onClose,
  onManageLibrary,
  onUnitChange,
  onUpdateDraft,
  type,
  unitOptions,
  employees,
  equipment,
  materials,
  item,
}: {
  draft: EstimateBuilderDraft
  employees: OrganizationEmployeeLibraryItem[]
  equipment: OrganizationEquipmentLibraryItem[]
  item: ProjectItemMetric
  materials: OrganizationMaterialLibraryItem[]
  onClose: () => void
  onManageLibrary: () => void
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

  const title = getBucketLabel(type) + ' picker'
  const subtitle = 'Search company prefills, compare rates, and apply values without leaving ' + (item.item_name ?? 'this item') + '.'

  return (
    <FloatingPanel
      actions={
        <button className="secondary-button" onClick={onManageLibrary} type="button">
          Manage company library
        </button>
      }
      onClose={onClose}
      title={title}
      subtitle={subtitle}
    >
      <div className="resource-sheet-grid">
        <section className="resource-sheet-editor">
          <div className="resource-sheet-editor-header">
            <div>
              <h3>Current values</h3>
              <p>
                {item.item_code ?? 'Scope'} · {item.item_name ?? 'Scope item'}
              </p>
            </div>
            <div className="resource-sheet-readout">
              <span>{getBucketLabel(type)} total</span>
              <strong>
                {formatCurrency(
                  type === 'labor'
                    ? derived.laborCost
                    : type === 'equipment'
                      ? derived.equipmentCost
                      : derived.materialCost,
                )}
              </strong>
            </div>
          </div>

          {type === 'materials' ? (
            <div className="resource-sheet-form">
              <div className="resource-sheet-form-grid">
                <label className="resource-sheet-field">
                  <span>Quantity</span>
                  <input disabled type="text" value={formatNumber(derived.quantity)} />
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
              <div className="resource-sheet-form-grid">
                <label className="resource-sheet-field">
                  <span>Cost / unit</span>
                  <input
                    aria-label={(item.item_name ?? 'Scope item') + ' material cost per unit'}
                    min="0"
                    onBlur={() => onUpdateDraft({}, true)}
                    onChange={(event) => onUpdateDraft({ materialCostPerUnit: event.target.value })}
                    step="0.01"
                    type="number"
                    value={draft.materialCostPerUnit}
                  />
                </label>
                <div className="resource-sheet-readout resource-sheet-readout-soft">
                  <span>Extended material</span>
                  <strong>{formatCurrency(derived.materialCost)}</strong>
                  <small>
                    {formatNumber(derived.quantity)} {draft.unit}
                  </small>
                </div>
              </div>
            </div>
          ) : null}

          {type === 'labor' ? (
            <div className="resource-sheet-form resource-sheet-form-grid">
              <label className="resource-sheet-field">
                <span>Hours</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' labor hours'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ laborHours: event.target.value })}
                  step="0.1"
                  type="number"
                  value={draft.laborHours}
                />
              </label>
              <label className="resource-sheet-field">
                <span>Rate / hour</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' labor rate'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ laborRate: event.target.value })}
                  step="0.01"
                  type="number"
                  value={draft.laborRate}
                />
              </label>
            </div>
          ) : null}

          {type === 'equipment' ? (
            <div className="resource-sheet-form resource-sheet-form-grid">
              <label className="resource-sheet-field">
                <span>Days</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' equipment days'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ equipmentDays: event.target.value })}
                  step="0.1"
                  type="number"
                  value={draft.equipmentDays}
                />
              </label>
              <label className="resource-sheet-field">
                <span>Cost / day</span>
                <input
                  aria-label={(item.item_name ?? 'Scope item') + ' equipment rate'}
                  min="0"
                  onBlur={() => onUpdateDraft({}, true)}
                  onChange={(event) => onUpdateDraft({ equipmentRate: event.target.value })}
                  step="0.01"
                  type="number"
                  value={draft.equipmentRate}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="resource-sheet-library">
          <div className="resource-sheet-library-header">
            <div>
              <h3>Company prefills</h3>
              <p>Search by name, role, or unit and apply a rate instantly.</p>
            </div>
          </div>

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
                      onUpdateDraft({ laborRate: String(employee.hourly_rate) }, true)
                      onClose()
                    }}
                    type="button"
                  >
                    <div className="resource-sheet-option-copy">
                      <strong>{employee.name}</strong>
                      <span>{employee.role || 'Labor prefill'}</span>
                    </div>
                    <div className="resource-sheet-option-value">
                      <strong>{formatCurrency(employee.hourly_rate)}</strong>
                      <span>/ hr · Apply</span>
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
                      onUpdateDraft({ equipmentRate: String(equipmentItem.daily_rate) }, true)
                      onClose()
                    }}
                    type="button"
                  >
                    <div className="resource-sheet-option-copy">
                      <strong>{equipmentItem.name}</strong>
                      <span>Equipment prefill</span>
                    </div>
                    <div className="resource-sheet-option-value">
                      <strong>{formatCurrency(equipmentItem.daily_rate)}</strong>
                      <span>/ day · Apply</span>
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
                      onUpdateDraft(
                        {
                          materialCostPerUnit: String(material.cost_per_unit),
                          unit: material.unit.toUpperCase(),
                        },
                        true,
                      )
                      onClose()
                    }}
                    type="button"
                  >
                    <div className="resource-sheet-option-copy">
                      <strong>{material.name}</strong>
                      <span>{material.unit}</span>
                    </div>
                    <div className="resource-sheet-option-value">
                      <strong>{formatCurrency(material.cost_per_unit)}</strong>
                      <span>/ unit · Apply</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>
      </div>
    </FloatingPanel>
  )
}

export const ProjectEstimateBuilder = ({
  employeeLibrary,
  equipmentLibrary,
  items,
  materialLibrary,
  onManageLibrary,
  onSaveRow,
  projectId,
  readOnly = false,
}: ProjectEstimateBuilderProps) => {
  const [customUnits, setCustomUnits] = useState<string[]>([])
  const [draftOverrides, setDraftOverrides] = useState<Record<string, EstimateBuilderDraft>>({})
  const [openPicker, setOpenPicker] = useState<PickerState | null>(null)
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

  const builderSummary = useMemo(
    () =>
      items.reduce(
        (summary, item) => {
          const key = getItemKey(item)
          const draft = drafts[key]
          const derived = derivedByKey[key]

          if (!draft || !derived) {
            return summary
          }

          if (draft.isIncluded) {
            summary.includedCount += 1
            summary.includedTotal += derived.totalCost
          }

          summary.itemCount += 1
          summary.labor += derived.laborCost
          summary.materials += derived.materialCost
          summary.equipment += derived.equipmentCost
          return summary
        },
        {
          equipment: 0,
          includedCount: 0,
          includedTotal: 0,
          itemCount: 0,
          labor: 0,
          materials: 0,
        },
      ),
    [derivedByKey, drafts, items],
  )

  const persistDraft = async (key: string, draft: EstimateBuilderDraft) => {
    if (readOnly) {
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

  const getSaveLabel = (key: string) => {
    if (rowSaveState[key] === 'error') {
      return 'Needs retry'
    }

    if (rowSaveState[key] === 'pending' || rowSaveState[key] === 'saving') {
      return 'Syncing…'
    }

    return readOnly ? 'Read-only' : 'Synced'
  }

  if (items.length === 0) {
    return <div className="panel-empty">No terminal items yet.</div>
  }

  const activeItem = openPicker ? itemsByKey.get(openPicker.itemId) ?? null : null
  const activeDraft = openPicker ? drafts[openPicker.itemId] ?? null : null

  const renderBucketGrid = (
    key: string,
    draft: EstimateBuilderDraft,
    derived: EstimateBuilderDerived,
  ) => (
    <div className="project-builder-bucket-grid">
      <BucketButton
        amount={formatCurrency(derived.materialCost)}
        disabled={readOnly}
        label="Materials"
        onClick={() => setOpenPicker({ bucket: 'materials', itemId: key })}
        summary={draft.unit + ' · ' + formatCurrency(derived.materialCostPerUnit) + ' / unit'}
      />
      <BucketButton
        amount={formatCurrency(derived.laborCost)}
        disabled={readOnly}
        label="Labor"
        onClick={() => setOpenPicker({ bucket: 'labor', itemId: key })}
        summary={formatNumber(derived.laborHours) + ' hrs · ' + formatCurrency(derived.laborRate) + ' / hr'}
      />
      <BucketButton
        amount={formatCurrency(derived.equipmentCost)}
        disabled={readOnly}
        label="Equipment"
        onClick={() => setOpenPicker({ bucket: 'equipment', itemId: key })}
        summary={formatNumber(derived.equipmentDays) + ' days · ' + formatCurrency(derived.equipmentRate) + ' / day'}
      />
    </div>
  )

  return (
    <div className="project-builder-shell">
      <aside className="project-builder-summary-shell">
        <div className="project-builder-summary-grid">
          <div className="project-builder-summary-card project-builder-summary-card-strong">
            <span>Estimate total</span>
            <strong>{formatCurrency(builderSummary.includedTotal)}</strong>
            <small>Included scope estimate</small>
          </div>
          <div className="project-builder-summary-card">
            <span>Included scopes</span>
            <strong>
              {builderSummary.includedCount}/{builderSummary.itemCount}
            </strong>
            <small>{formatCurrency(builderSummary.includedTotal)}</small>
          </div>
          <div className="project-builder-summary-card">
            <span>Materials</span>
            <strong>{formatCurrency(builderSummary.materials)}</strong>
            <small>Visible on each picker</small>
          </div>
          <div className="project-builder-summary-card">
            <span>Labor</span>
            <strong>{formatCurrency(builderSummary.labor)}</strong>
            <small>Hours + rates</small>
          </div>
          <div className="project-builder-summary-card">
            <span>Equipment</span>
            <strong>{formatCurrency(builderSummary.equipment)}</strong>
            <small>Days + daily rates</small>
          </div>
        </div>
      </aside>

      <div className="project-builder-section-list">
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
              <div className="project-builder-section-total">
                <span>Section estimate</span>
                <strong>{formatCurrency(section.estimatedTotal)}</strong>
              </div>
            </div>

            <div className="project-builder-card-list project-builder-desktop-list">
              {section.items.map((item) => {
                const key = getItemKey(item)
                const draft = drafts[key]
                const derived = derivedByKey[key]
                const unitOptions = buildUnitOptions(draft.unit, customUnits)

                return (
                  <article
                    className={'project-builder-card' + (draft.isIncluded ? '' : ' project-builder-card-muted')}
                    key={key}
                  >
                    <div className="project-builder-card-layout">
                      <div className="project-builder-card-main">
                        <div className="project-builder-card-header">
                          <div className="project-builder-card-copy">
                            <div className="project-builder-card-tags">
                              {!readOnly ? (
                                <label className="project-builder-include-toggle">
                                  <input
                                    aria-label={'Toggle ' + (draft.itemName || 'scope item')}
                                    checked={draft.isIncluded}
                                    onChange={(event) => {
                                      updateDraft(key, { isIncluded: event.target.checked }, true)
                                    }}
                                    type="checkbox"
                                  />
                                  <span>{draft.isIncluded ? 'Included' : 'Excluded'}</span>
                                </label>
                              ) : (
                                <span className="worksheet-mobile-flag">
                                  {draft.isIncluded ? 'Included' : 'Excluded'}
                                </span>
                              )}
                              <span className="scope-code-pill mono">{item.item_code}</span>
                              <span className="scope-unit-pill">{draft.unit}</span>
                            </div>
                            {readOnly ? (
                              <strong className="project-builder-card-title">{draft.itemName}</strong>
                            ) : (
                              <input
                                aria-label={(item.item_code ?? 'Scope') + ' scope name'}
                                className="project-builder-name-input"
                                onBlur={() => flushAutoSave(key, draft)}
                                onChange={(event) => updateDraft(key, { itemName: event.target.value })}
                                type="text"
                                value={draft.itemName}
                              />
                            )}
                          </div>
                        </div>

                        <div className="project-builder-fields-grid">
                          <label className="project-builder-field">
                            <span>Quantity</span>
                            <input
                              aria-label={(item.item_name ?? 'Scope item') + ' quantity'}
                              disabled={readOnly}
                              min="0"
                              onBlur={() => flushAutoSave(key, draft)}
                              onChange={(event) => updateDraft(key, { quantity: event.target.value })}
                              step="0.1"
                              type="number"
                              value={draft.quantity}
                            />
                          </label>
                          <label className="project-builder-field">
                            <span>Unit</span>
                            <select
                              className="item-detail-select"
                              disabled={readOnly}
                              onChange={(event) => handleUnitChange(key, event.target.value)}
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
                          <label className="project-builder-field">
                            <span>Subcontractor</span>
                            <input
                              aria-label={(item.item_name ?? 'Scope item') + ' subcontract cost'}
                              disabled={readOnly}
                              min="0"
                              onBlur={() => flushAutoSave(key, draft)}
                              onChange={(event) => updateDraft(key, { subcontractCost: event.target.value })}
                              step="0.01"
                              type="number"
                              value={draft.subcontractCost}
                            />
                          </label>
                          <label className="project-builder-field">
                            <span>O/H %</span>
                            <input
                              aria-label={(item.item_name ?? 'Scope item') + ' overhead percent'}
                              disabled={readOnly}
                              min="0"
                              onBlur={() => flushAutoSave(key, draft)}
                              onChange={(event) => updateDraft(key, { overheadPercent: event.target.value })}
                              step="1"
                              type="number"
                              value={draft.overheadPercent}
                            />
                          </label>
                          <label className="project-builder-field">
                            <span>Profit %</span>
                            <input
                              aria-label={(item.item_name ?? 'Scope item') + ' profit percent'}
                              disabled={readOnly}
                              min="0"
                              onBlur={() => flushAutoSave(key, draft)}
                              onChange={(event) => updateDraft(key, { profitPercent: event.target.value })}
                              step="1"
                              type="number"
                              value={draft.profitPercent}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="project-builder-card-aside">
                        <div className="project-builder-card-total">
                          <span>Total estimate</span>
                          <strong>{formatCurrency(derived.totalCost)}</strong>
                          <small className={'row-save-state row-save-' + (rowSaveState[key] ?? 'saved')}>
                            {getSaveLabel(key)}
                          </small>
                        </div>

                        <div className="project-builder-inline-readout">
                          <span>Direct cost</span>
                          <strong>{formatCurrency(derived.directCost)}</strong>
                          <small>
                            {formatCurrency(derived.overheadCost)} O/H · {formatCurrency(derived.profitCost)} profit
                          </small>
                        </div>

                        <div className="project-builder-card-footer">
                          <Link className="ghost-button project-builder-advanced-link" to={'/projects/' + projectId + '/items/' + key}>
                            Advanced editor
                          </Link>
                        </div>
                      </div>
                    </div>

                    {renderBucketGrid(key, draft, derived)}
                  </article>
                )
              })}
            </div>

            <div className="project-builder-mobile-list">
              {section.items.map((item) => {
                const key = getItemKey(item)
                const draft = drafts[key]
                const derived = derivedByKey[key]
                const unitOptions = buildUnitOptions(draft.unit, customUnits)

                return (
                  <details
                    className={'worksheet-mobile-card' + (draft.isIncluded ? '' : ' worksheet-mobile-card-muted')}
                    key={key}
                  >
                    <summary className="worksheet-mobile-card-summary">
                      <div className="worksheet-mobile-card-summary-main">
                        <div className="worksheet-mobile-card-tags">
                          <span className="scope-code-pill mono">{item.item_code}</span>
                          <span className="scope-unit-pill">{draft.unit}</span>
                          {!draft.isIncluded ? (
                            <span className="worksheet-mobile-flag">Excluded</span>
                          ) : null}
                        </div>
                        <strong>{draft.itemName}</strong>
                        <small className="project-builder-mobile-summary-line">
                          M {formatCurrency(derived.materialCost)} · L {formatCurrency(derived.laborCost)} · E {formatCurrency(derived.equipmentCost)}
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
                      ) : null}

                      <div className="project-builder-fields-grid project-builder-fields-grid-mobile">
                        <label className="project-builder-field">
                          <span>Quantity</span>
                          <input
                            aria-label={(item.item_name ?? 'Scope item') + ' quantity'}
                            disabled={readOnly}
                            min="0"
                            onBlur={() => flushAutoSave(key, draft)}
                            onChange={(event) => updateDraft(key, { quantity: event.target.value })}
                            step="0.1"
                            type="number"
                            value={draft.quantity}
                          />
                        </label>
                        <label className="project-builder-field">
                          <span>Unit</span>
                          <select
                            className="item-detail-select"
                            disabled={readOnly}
                            onChange={(event) => handleUnitChange(key, event.target.value)}
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
                        <label className="project-builder-field">
                          <span>Subcontractor</span>
                          <input
                            aria-label={(item.item_name ?? 'Scope item') + ' subcontract cost'}
                            disabled={readOnly}
                            min="0"
                            onBlur={() => flushAutoSave(key, draft)}
                            onChange={(event) => updateDraft(key, { subcontractCost: event.target.value })}
                            step="0.01"
                            type="number"
                            value={draft.subcontractCost}
                          />
                        </label>
                        <label className="project-builder-field">
                          <span>O/H %</span>
                          <input
                            aria-label={(item.item_name ?? 'Scope item') + ' overhead percent'}
                            disabled={readOnly}
                            min="0"
                            onBlur={() => flushAutoSave(key, draft)}
                            onChange={(event) => updateDraft(key, { overheadPercent: event.target.value })}
                            step="1"
                            type="number"
                            value={draft.overheadPercent}
                          />
                        </label>
                        <label className="project-builder-field">
                          <span>Profit %</span>
                          <input
                            aria-label={(item.item_name ?? 'Scope item') + ' profit percent'}
                            disabled={readOnly}
                            min="0"
                            onBlur={() => flushAutoSave(key, draft)}
                            onChange={(event) => updateDraft(key, { profitPercent: event.target.value })}
                            step="1"
                            type="number"
                            value={draft.profitPercent}
                          />
                        </label>
                        <div className="project-builder-inline-readout">
                          <span>Direct cost</span>
                          <strong>{formatCurrency(derived.directCost)}</strong>
                          <small>
                            {formatCurrency(derived.overheadCost)} O/H · {formatCurrency(derived.profitCost)} profit
                          </small>
                        </div>
                      </div>

                      {renderBucketGrid(key, draft, derived)}

                      <Link
                        className="ghost-button project-builder-advanced-link project-builder-advanced-link-full"
                        to={'/projects/' + projectId + '/items/' + key}
                      >
                        Advanced editor
                      </Link>
                    </div>
                  </details>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {activeItem && activeDraft && openPicker ? (
        <ResourcePickerPanel
          draft={activeDraft}
          employees={employeeLibrary}
          equipment={equipmentLibrary}
          item={activeItem}
          materials={materialLibrary}
          onClose={handleClosePicker}
          onManageLibrary={() => {
            handleClosePicker()
            onManageLibrary()
          }}
          onUnitChange={(value) => handleUnitChange(openPicker.itemId, value)}
          onUpdateDraft={(patch, persistImmediately) => updateDraft(openPicker.itemId, patch, persistImmediately)}
          type={openPicker.bucket}
          unitOptions={buildUnitOptions(activeDraft.unit, customUnits)}
        />
      ) : null}
    </div>
  )
}
