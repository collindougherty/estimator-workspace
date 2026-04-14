import { useEffect, useMemo, useRef, useState } from 'react'

import { formatCurrency, formatNumber } from '../lib/formatters'
import {
  numericDraftFields,
  toEstimateDraft,
  type EstimateDraft,
  type ProjectEstimateItemUpdate,
  type ProjectItemActualUpdate,
  type ProjectItemMetric,
} from '../lib/models'

type RowSaveState = 'saved' | 'pending' | 'saving' | 'error'

type TrackingDraft = {
  actual_quantity: string
  actual_labor_hours: string
  actual_labor_cost: string
  actual_material_cost: string
  actual_equipment_days: string
  actual_equipment_cost: string
  actual_subcontract_cost: string
  actual_overhead_cost: string
  actual_profit_amount: string
}

type SectionGroup = {
  key: string
  sectionCode: string
  sectionName: string
  items: ProjectItemMetric[]
  estimatedTotal: number
  actualTotal: number
}

const getItemKey = (item: ProjectItemMetric) => item.project_estimate_item_id ?? item.item_code ?? ''

const parseNumericInput = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const isEstimateDraftDirty = (draft: EstimateDraft, item: ProjectItemMetric) => {
  const baseline = toEstimateDraft(item)

  if (draft.is_included !== baseline.is_included) {
    return true
  }

  if (draft.item_name !== baseline.item_name) {
    return true
  }

  return numericDraftFields.some((field) => draft[field] !== baseline[field])
}

const toTrackingDraft = (item: ProjectItemMetric): TrackingDraft => ({
  actual_quantity: String(item.actual_quantity ?? 0),
  actual_labor_hours: String(item.actual_labor_hours ?? 0),
  actual_labor_cost: String(item.actual_labor_cost ?? 0),
  actual_material_cost: String(item.actual_material_cost ?? 0),
  actual_equipment_days: String(item.actual_equipment_days ?? 0),
  actual_equipment_cost: String(item.actual_equipment_cost ?? 0),
  actual_subcontract_cost: String(item.actual_subcontract_cost ?? 0),
  actual_overhead_cost: String(item.actual_overhead_cost ?? 0),
  actual_profit_amount: String(item.actual_profit_amount ?? 0),
})

const isTrackingDraftDirty = (draft: TrackingDraft, item: ProjectItemMetric) => {
  const baseline = toTrackingDraft(item)

  return (
    draft.actual_quantity !== baseline.actual_quantity ||
    draft.actual_labor_hours !== baseline.actual_labor_hours ||
    draft.actual_labor_cost !== baseline.actual_labor_cost ||
    draft.actual_material_cost !== baseline.actual_material_cost ||
    draft.actual_equipment_days !== baseline.actual_equipment_days ||
    draft.actual_equipment_cost !== baseline.actual_equipment_cost ||
    draft.actual_subcontract_cost !== baseline.actual_subcontract_cost ||
    draft.actual_overhead_cost !== baseline.actual_overhead_cost ||
    draft.actual_profit_amount !== baseline.actual_profit_amount
  )
}

const buildSectionGroups = (items: ProjectItemMetric[]) => {
  const groups: SectionGroup[] = []

  for (const item of items) {
    const sectionCode = item.section_code ?? '—'
    const sectionName = item.section_name ?? 'Unassigned scope'
    const key = `${sectionCode}:${sectionName}`
    const existingGroup = groups[groups.length - 1]

    if (!existingGroup || existingGroup.key !== key) {
      groups.push({
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

  return groups
}

const EstimateMobileWorksheet = ({
  items,
  isSaving,
  onSaveRow,
  readOnly = false,
}: {
  items: ProjectItemMetric[]
  isSaving: string | null
  onSaveRow: (itemId: string, patch: ProjectEstimateItemUpdate) => Promise<void>
  readOnly?: boolean
}) => {
  const [draftOverrides, setDraftOverrides] = useState<Record<string, EstimateDraft>>({})
  const [rowSaveState, setRowSaveState] = useState<Record<string, RowSaveState>>({})
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
          return [key, draftOverrides[key] ?? toEstimateDraft(item)]
        }),
      ),
    [draftOverrides, items],
  )

  const sectionGroups = useMemo(() => buildSectionGroups(items), [items])

  const persistDraft = async (key: string, draft: EstimateDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    if (draft.item_name.trim() === '') {
      setRowSaveState((current) => ({ ...current, [key]: 'error' }))
      return
    }

    if (!isEstimateDraftDirty(draft, item)) {
      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'saving' }))

    try {
      await onSaveRow(key, {
        item_name: draft.item_name.trim(),
        is_included: draft.is_included,
        quantity: parseNumericInput(draft.quantity),
        labor_hours: parseNumericInput(draft.labor_hours),
        labor_rate: parseNumericInput(draft.labor_rate),
        material_cost: parseNumericInput(draft.material_cost),
        equipment_days: parseNumericInput(draft.equipment_days),
        equipment_rate: parseNumericInput(draft.equipment_rate),
        subcontract_cost: parseNumericInput(draft.subcontract_cost),
        overhead_percent: parseNumericInput(draft.overhead_percent),
        profit_percent: parseNumericInput(draft.profit_percent),
      })

      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
    } catch {
      setRowSaveState((current) => ({ ...current, [key]: 'error' }))
    }
  }

  const queueAutoSave = (key: string, draft: EstimateDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'pending' }))
    window.clearTimeout(saveTimeouts.current[key])
    saveTimeouts.current[key] = window.setTimeout(() => {
      void persistDraft(key, draft, item)
    }, 1200)
  }

  const flushAutoSave = (key: string, draft: EstimateDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    window.clearTimeout(saveTimeouts.current[key])
    void persistDraft(key, draft, item)
  }

  const updateDraft = (
    key: string,
    field: keyof EstimateDraft,
    value: EstimateDraft[keyof EstimateDraft],
  ) => {
    const item = itemsByKey.get(key)
    const baselineDraft = item ? drafts[key] ?? toEstimateDraft(item) : null
    let nextDraft: EstimateDraft | null = null

    setDraftOverrides((current) => {
      const currentDraft = current[key] ?? baselineDraft

      if (!currentDraft) {
        return current
      }

      nextDraft = {
        ...currentDraft,
        [field]: value,
      }

      return {
        ...current,
        [key]: nextDraft,
      }
    })

    if (item && nextDraft) {
      queueAutoSave(key, nextDraft, item)
    }
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

  if (items.length === 0) {
    return <div className="panel-empty">No scopes yet.</div>
  }

  return (
    <div className="worksheet-mobile">
      {sectionGroups.map((section) => (
        <section className="worksheet-mobile-section" key={section.key}>
          <div className="worksheet-mobile-section-header">
            <div>
              <span className="eyebrow">{section.sectionCode}</span>
              <h3>{section.sectionName}</h3>
            </div>
            <strong>{formatCurrency(section.estimatedTotal)}</strong>
          </div>
          <div className="worksheet-mobile-card-list">
            {section.items.map((item) => {
              const key = getItemKey(item)
              const draft = drafts[key]

              if (!draft) {
                return null
              }

              return (
                <details
                  className={`worksheet-mobile-card${draft.is_included ? '' : ' worksheet-mobile-card-muted'}`}
                  key={key}
                >
                  <summary className="worksheet-mobile-card-summary">
                    <div className="worksheet-mobile-card-summary-main">
                      <div className="worksheet-mobile-card-tags">
                        <span className="scope-code-pill mono">{item.item_code}</span>
                        <span className="scope-unit-pill">{item.unit}</span>
                        {!draft.is_included ? (
                          <span className="worksheet-mobile-flag">Excluded</span>
                        ) : null}
                      </div>
                      <strong>{draft.item_name}</strong>
                    </div>
                    <div className="worksheet-mobile-card-total">
                      <span>Estimate</span>
                      <strong>{formatCurrency(item.estimated_total_cost)}</strong>
                    </div>
                  </summary>
                  <div className="worksheet-mobile-card-body">
                    {!readOnly ? (
                      <>
                        <label className="worksheet-mobile-toggle">
                          <span>Include in proposal</span>
                          <input
                            aria-label={`Toggle ${item.item_name}`}
                            checked={draft.is_included}
                            onChange={(event) => {
                              updateDraft(key, 'is_included', event.target.checked)
                            }}
                            type="checkbox"
                          />
                        </label>
                        <label className="estimate-bucket-field">
                          <span>Scope</span>
                          <input
                            aria-label={`${item.item_code} scope name`}
                            onBlur={() => {
                              flushAutoSave(key, draft, item)
                            }}
                            onChange={(event) => {
                              updateDraft(key, 'item_name', event.target.value)
                            }}
                            type="text"
                            value={draft.item_name}
                          />
                        </label>
                      </>
                    ) : (
                      <div className="worksheet-mobile-readonly-row">
                        <span>Included in proposal</span>
                        <strong>{draft.is_included ? 'Included' : 'Excluded'}</strong>
                      </div>
                    )}

                    <div className="worksheet-mobile-bucket-grid">
                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Labor</h4>
                          <span>{formatCurrency(item.estimated_labor_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Hours</span>
                            {readOnly ? (
                              <strong>{draft.labor_hours}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} labor hours`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'labor_hours', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.labor_hours}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Rate</span>
                            {readOnly ? (
                              <strong>{formatCurrency(Number(draft.labor_rate))}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} labor rate`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'labor_rate', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.labor_rate}
                              />
                            )}
                          </label>
                        </div>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Materials</h4>
                          <span>{formatCurrency(item.material_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Qty</span>
                            {readOnly ? (
                              <strong>{draft.quantity}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} quantity`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'quantity', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.quantity}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(Number(draft.material_cost))}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} material cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'material_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.material_cost}
                              />
                            )}
                          </label>
                        </div>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Equipment</h4>
                          <span>{formatCurrency(item.estimated_equipment_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Days</span>
                            {readOnly ? (
                              <strong>{draft.equipment_days}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} equipment days`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'equipment_days', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.equipment_days}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Rate</span>
                            {readOnly ? (
                              <strong>{formatCurrency(Number(draft.equipment_rate))}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} equipment rate`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'equipment_rate', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.equipment_rate}
                              />
                            )}
                          </label>
                        </div>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Subcontract</h4>
                          <span>{formatCurrency(item.subcontract_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid worksheet-mobile-input-grid-single">
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(Number(draft.subcontract_cost))}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} subcontract cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'subcontract_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.subcontract_cost}
                              />
                            )}
                          </label>
                        </div>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>O/H + Profit</h4>
                          <span>
                            {formatCurrency(item.estimated_overhead_cost)} ·{' '}
                            {formatCurrency(item.estimated_profit_cost)}
                          </span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>O/H %</span>
                            {readOnly ? (
                              <strong>{draft.overhead_percent}%</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} overhead percent`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'overhead_percent', event.target.value)
                                }}
                                step="1"
                                type="number"
                                value={draft.overhead_percent}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Profit %</span>
                            {readOnly ? (
                              <strong>{draft.profit_percent}%</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} profit percent`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'profit_percent', event.target.value)
                                }}
                                step="1"
                                type="number"
                                value={draft.profit_percent}
                              />
                            )}
                          </label>
                        </div>
                      </section>
                    </div>

                    <div className="worksheet-mobile-footer">
                      <div>
                        <span>Total</span>
                        <strong>{formatCurrency(item.estimated_total_cost)}</strong>
                      </div>
                      {!readOnly ? (
                        <span className={`row-save-state row-save-${rowSaveState[key] ?? 'saved'}`}>
                          {getSaveLabel(key)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

const TrackingMobileWorksheet = ({
  items,
  isSaving,
  onSaveRow,
  readOnly = false,
}: {
  items: ProjectItemMetric[]
  isSaving: string | null
  onSaveRow: (itemId: string, patch: ProjectItemActualUpdate) => Promise<void>
  readOnly?: boolean
}) => {
  const [draftOverrides, setDraftOverrides] = useState<Record<string, TrackingDraft>>({})
  const [rowSaveState, setRowSaveState] = useState<Record<string, RowSaveState>>({})
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
          return [key, draftOverrides[key] ?? toTrackingDraft(item)]
        }),
      ),
    [draftOverrides, items],
  )

  const sectionGroups = useMemo(() => buildSectionGroups(items), [items])

  const persistDraft = async (key: string, draft: TrackingDraft, item: ProjectItemMetric) => {
    if (readOnly) {
      return
    }

    if (!isTrackingDraftDirty(draft, item)) {
      setRowSaveState((current) => ({ ...current, [key]: 'saved' }))
      return
    }

    setRowSaveState((current) => ({ ...current, [key]: 'saving' }))

    try {
      await onSaveRow(key, {
        actual_quantity: parseNumericInput(draft.actual_quantity),
        actual_labor_hours: parseNumericInput(draft.actual_labor_hours),
        actual_labor_cost: parseNumericInput(draft.actual_labor_cost),
        actual_material_cost: parseNumericInput(draft.actual_material_cost),
        actual_equipment_days: parseNumericInput(draft.actual_equipment_days),
        actual_equipment_cost: parseNumericInput(draft.actual_equipment_cost),
        actual_subcontract_cost: parseNumericInput(draft.actual_subcontract_cost),
        actual_overhead_cost: parseNumericInput(draft.actual_overhead_cost),
        actual_profit_amount: parseNumericInput(draft.actual_profit_amount),
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

  const updateDraft = (
    key: string,
    field: keyof TrackingDraft,
    value: TrackingDraft[keyof TrackingDraft],
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
        [field]: value,
      }

      return {
        ...current,
        [key]: nextDraft,
      }
    })

    if (item && nextDraft) {
      queueAutoSave(key, nextDraft, item)
    }
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

  if (items.length === 0) {
    return <div className="panel-empty">No scopes yet.</div>
  }

  return (
    <div className="worksheet-mobile">
      {sectionGroups.map((section) => (
        <section className="worksheet-mobile-section" key={section.key}>
          <div className="worksheet-mobile-section-header">
            <div>
              <span className="eyebrow">{section.sectionCode}</span>
              <h3>{section.sectionName}</h3>
            </div>
            <strong>{formatCurrency(section.actualTotal)}</strong>
            <span>Bid {formatCurrency(section.estimatedTotal)}</span>
          </div>
          <div className="worksheet-mobile-card-list">
            {section.items.map((item) => {
              const key = getItemKey(item)
              const draft = drafts[key]

              if (!draft) {
                return null
              }

              return (
                <details className="worksheet-mobile-card" key={key}>
                  <summary className="worksheet-mobile-card-summary">
                    <div className="worksheet-mobile-card-summary-main">
                      <div className="worksheet-mobile-card-tags">
                        <span className="scope-code-pill mono">{item.item_code}</span>
                        <span className="scope-unit-pill">{item.unit}</span>
                      </div>
                      <strong>{item.item_name}</strong>
                    </div>
                    <div className="worksheet-mobile-card-total">
                      <span>Actual</span>
                      <strong>{formatCurrency(item.actual_total_cost)}</strong>
                      <small>Bid {formatCurrency(item.estimated_total_cost)}</small>
                    </div>
                  </summary>
                  <div className="worksheet-mobile-card-body">
                    <div className="worksheet-mobile-bucket-grid">
                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Labor</h4>
                          <span>{formatCurrency(item.actual_labor_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Hours</span>
                            {readOnly ? (
                              <strong>{formatNumber(item.actual_labor_hours)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual labor hours`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_labor_hours', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_labor_hours}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_labor_cost)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual labor cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_labor_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_labor_cost}
                              />
                            )}
                          </label>
                        </div>
                        <span className="worksheet-mobile-reference">
                          Bid {formatNumber(item.labor_hours)} hrs · {formatCurrency(item.estimated_labor_cost)}
                        </span>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Materials</h4>
                          <span>{formatCurrency(item.actual_material_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Qty</span>
                            {readOnly ? (
                              <strong>{formatNumber(item.actual_quantity)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual quantity`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_quantity', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_quantity}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_material_cost)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual material cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_material_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_material_cost}
                              />
                            )}
                          </label>
                        </div>
                        <span className="worksheet-mobile-reference">
                          Bid {formatNumber(item.quantity)} {item.unit} · {formatCurrency(item.material_cost)}
                        </span>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Equipment</h4>
                          <span>{formatCurrency(item.actual_equipment_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>Days</span>
                            {readOnly ? (
                              <strong>{formatNumber(item.actual_equipment_days)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual equipment days`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_equipment_days', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_equipment_days}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_equipment_cost)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual equipment cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_equipment_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_equipment_cost}
                              />
                            )}
                          </label>
                        </div>
                        <span className="worksheet-mobile-reference">
                          Bid {formatNumber(item.equipment_days)} days · {formatCurrency(item.estimated_equipment_cost)}
                        </span>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>Subcontract</h4>
                          <span>{formatCurrency(item.actual_subcontract_cost)}</span>
                        </div>
                        <div className="worksheet-mobile-input-grid worksheet-mobile-input-grid-single">
                          <label className="estimate-bucket-field">
                            <span>Cost</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_subcontract_cost)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual subcontract cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_subcontract_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_subcontract_cost}
                              />
                            )}
                          </label>
                        </div>
                        <span className="worksheet-mobile-reference">Bid {formatCurrency(item.subcontract_cost)}</span>
                      </section>

                      <section className="worksheet-mobile-bucket">
                        <div className="worksheet-mobile-bucket-header">
                          <h4>O/H + Profit</h4>
                          <span>
                            {formatCurrency(item.actual_overhead_cost)} · {formatCurrency(item.actual_profit_amount)}
                          </span>
                        </div>
                        <div className="worksheet-mobile-input-grid">
                          <label className="estimate-bucket-field">
                            <span>O/H</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_overhead_cost)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual overhead cost`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_overhead_cost', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_overhead_cost}
                              />
                            )}
                          </label>
                          <label className="estimate-bucket-field">
                            <span>Profit</span>
                            {readOnly ? (
                              <strong>{formatCurrency(item.actual_profit_amount)}</strong>
                            ) : (
                              <input
                                aria-label={`${item.item_code} actual profit amount`}
                                min="0"
                                onBlur={() => {
                                  flushAutoSave(key, draft, item)
                                }}
                                onChange={(event) => {
                                  updateDraft(key, 'actual_profit_amount', event.target.value)
                                }}
                                step="0.1"
                                type="number"
                                value={draft.actual_profit_amount}
                              />
                            )}
                          </label>
                        </div>
                        <span className="worksheet-mobile-reference">
                          Bid {formatCurrency(item.estimated_overhead_cost)} · {formatCurrency(item.estimated_profit_cost)}
                        </span>
                      </section>
                    </div>

                    <div className="worksheet-mobile-footer">
                      <div>
                        <span>Actual</span>
                        <strong>{formatCurrency(item.actual_total_cost)}</strong>
                        <small>Bid {formatCurrency(item.estimated_total_cost)}</small>
                      </div>
                      {!readOnly ? (
                        <span className={`row-save-state row-save-${rowSaveState[key] ?? 'saved'}`}>
                          {getSaveLabel(key)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export const ProjectMobileWorksheet = ({
  items,
  mode,
  isSaving,
  onSaveEstimateRow,
  onSaveTrackingRow,
  readOnly = false,
}: {
  items: ProjectItemMetric[]
  mode: 'estimate' | 'tracking'
  isSaving: string | null
  onSaveEstimateRow: (itemId: string, patch: ProjectEstimateItemUpdate) => Promise<void>
  onSaveTrackingRow: (itemId: string, patch: ProjectItemActualUpdate) => Promise<void>
  readOnly?: boolean
}) =>
  mode === 'tracking' ? (
    <TrackingMobileWorksheet
      isSaving={isSaving}
      items={items}
      onSaveRow={onSaveTrackingRow}
      readOnly={readOnly}
    />
  ) : (
    <EstimateMobileWorksheet
      isSaving={isSaving}
      items={items}
      onSaveRow={onSaveEstimateRow}
      readOnly={readOnly}
    />
  )
