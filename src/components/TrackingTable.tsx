import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatCurrency, formatNumber } from '../lib/formatters'
import type { ProjectItemActualUpdate, ProjectItemMetric } from '../lib/models'
import { BucketControlButton } from './BucketControlButton'
import { FloatingPanel } from './FloatingPanel'

type RowSaveState = 'saved' | 'pending' | 'saving' | 'error'
type BucketKey = 'equipment' | 'labor' | 'materials' | 'markup' | 'subcontract'
type BucketPanelState = {
  bucket: BucketKey
  itemId: string
}

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

type TrackingDerived = {
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
  actual_labor_hours: String(item.actual_labor_hours ?? 0),
  actual_labor_cost: String(item.actual_labor_cost ?? 0),
  actual_material_cost: String(item.actual_material_cost ?? 0),
  actual_equipment_days: String(item.actual_equipment_days ?? 0),
  actual_equipment_cost: String(item.actual_equipment_cost ?? 0),
  actual_subcontract_cost: String(item.actual_subcontract_cost ?? 0),
  actual_overhead_cost: String(item.actual_overhead_cost ?? 0),
  actual_profit_amount: String(item.actual_profit_amount ?? 0),
})

const parseNumericInput = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const isDraftDirty = (draft: TrackingDraft, item: ProjectItemMetric) => {
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

const calculateTrackingDerived = (draft: TrackingDraft): TrackingDerived => {
  const actual_quantity = parseNumericInput(draft.actual_quantity)
  const actual_labor_hours = parseNumericInput(draft.actual_labor_hours)
  const actual_labor_cost = parseNumericInput(draft.actual_labor_cost)
  const actual_material_cost = parseNumericInput(draft.actual_material_cost)
  const actual_equipment_days = parseNumericInput(draft.actual_equipment_days)
  const actual_equipment_cost = parseNumericInput(draft.actual_equipment_cost)
  const actual_subcontract_cost = parseNumericInput(draft.actual_subcontract_cost)
  const actual_overhead_cost = parseNumericInput(draft.actual_overhead_cost)
  const actual_profit_amount = parseNumericInput(draft.actual_profit_amount)

  return {
    actual_equipment_cost,
    actual_equipment_days,
    actual_labor_cost,
    actual_labor_hours,
    actual_material_cost,
    actual_overhead_cost,
    actual_profit_amount,
    actual_quantity,
    actual_subcontract_cost,
    actual_total_cost:
      actual_labor_cost +
      actual_material_cost +
      actual_equipment_cost +
      actual_subcontract_cost +
      actual_overhead_cost +
      actual_profit_amount,
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
    return `${formatCurrency(derived.actual_overhead_cost)} O/H · ${formatCurrency(derived.actual_profit_amount)} profit`
  }

  return `${formatNumber(derived.actual_quantity)} ${item.unit ?? 'EA'} tracked`
}

const getTrackingBucketDetail = (
  bucket: BucketKey,
  item: ProjectItemMetric,
) => {
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
    return `Bid ${formatCurrency(item.estimated_overhead_cost)} · ${formatCurrency(item.estimated_profit_cost)}`
  }

  return `Bid ${formatCurrency(item.material_cost)}`
}

const TrackingBucketPanel = ({
  draft,
  item,
  onClose,
  onCommit,
  onUpdateDraft,
  type,
}: {
  draft: TrackingDraft
  item: ProjectItemMetric
  onClose: () => void
  onCommit: () => void
  onUpdateDraft: (field: keyof TrackingDraft, value: string) => void
  type: BucketKey
}) => {
  const derived = useMemo(() => calculateTrackingDerived(draft), [draft])
  const title =
    type === 'subcontract'
      ? 'Subcontract actuals'
      : type === 'markup'
        ? 'O/H + profit actuals'
        : getBucketLabel(type) + ' actuals'

  return (
    <FloatingPanel
      onClose={onClose}
      size="compact"
      subtitle={'Adjust actuals for ' + (item.item_name ?? 'this item') + ' from one focused editor.'}
      title={title}
    >
      <section className="resource-sheet-editor resource-sheet-editor-standalone">
        <div className="resource-sheet-editor-header">
          <div>
            <h3>Current values</h3>
            <p>
              {item.item_code ?? 'Scope'} · {item.item_name ?? 'Scope item'}
            </p>
          </div>
          <div className="resource-sheet-readout">
            <span>{getBucketLabel(type)} actual</span>
            <strong>{formatCurrency(getTrackingBucketTotal(type, derived))}</strong>
          </div>
        </div>

        {type === 'labor' ? (
          <div className="resource-sheet-form resource-sheet-form-grid">
            <label className="resource-sheet-field">
              <span>Hours</span>
              <input
                aria-label={`${item.item_code} actual labor hours`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_labor_hours', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_labor_hours}
              />
            </label>
            <label className="resource-sheet-field">
              <span>Cost</span>
              <input
                aria-label={`${item.item_code} actual labor cost`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_labor_cost', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_labor_cost}
              />
            </label>
            <div className="resource-sheet-readout resource-sheet-readout-soft">
              <span>Bid reference</span>
              <strong>{formatCurrency(item.estimated_labor_cost)}</strong>
              <small>{formatNumber(item.labor_hours)} hrs bid</small>
            </div>
          </div>
        ) : null}

        {type === 'materials' ? (
          <div className="resource-sheet-form resource-sheet-form-grid">
            <label className="resource-sheet-field">
              <span>Quantity</span>
              <input
                aria-label={`${item.item_code} actual quantity`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_quantity', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_quantity}
              />
            </label>
            <label className="resource-sheet-field">
              <span>Cost</span>
              <input
                aria-label={`${item.item_code} actual material cost`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_material_cost', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_material_cost}
              />
            </label>
            <div className="resource-sheet-readout resource-sheet-readout-soft">
              <span>Bid reference</span>
              <strong>{formatCurrency(item.material_cost)}</strong>
              <small>
                {formatNumber(item.quantity)} {item.unit}
              </small>
            </div>
          </div>
        ) : null}

        {type === 'equipment' ? (
          <div className="resource-sheet-form resource-sheet-form-grid">
            <label className="resource-sheet-field">
              <span>Days</span>
              <input
                aria-label={`${item.item_code} actual equipment days`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_equipment_days', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_equipment_days}
              />
            </label>
            <label className="resource-sheet-field">
              <span>Cost</span>
              <input
                aria-label={`${item.item_code} actual equipment cost`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_equipment_cost', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_equipment_cost}
              />
            </label>
            <div className="resource-sheet-readout resource-sheet-readout-soft">
              <span>Bid reference</span>
              <strong>{formatCurrency(item.estimated_equipment_cost)}</strong>
              <small>{formatNumber(item.equipment_days)} days bid</small>
            </div>
          </div>
        ) : null}

        {type === 'subcontract' ? (
          <div className="resource-sheet-form">
            <label className="resource-sheet-field">
              <span>Subcontract cost</span>
              <input
                aria-label={`${item.item_code} actual subcontract cost`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_subcontract_cost', event.target.value)}
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
          <div className="resource-sheet-form resource-sheet-form-grid">
            <label className="resource-sheet-field">
              <span>O/H</span>
              <input
                aria-label={`${item.item_code} actual overhead cost`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_overhead_cost', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_overhead_cost}
              />
            </label>
            <label className="resource-sheet-field">
              <span>Profit</span>
              <input
                aria-label={`${item.item_code} actual profit amount`}
                min="0"
                onBlur={onCommit}
                onChange={(event) => onUpdateDraft('actual_profit_amount', event.target.value)}
                step="0.1"
                type="number"
                value={draft.actual_profit_amount}
              />
            </label>
            <div className="resource-sheet-readout resource-sheet-readout-soft">
              <span>Bid reference</span>
              <strong>{formatCurrency((item.estimated_overhead_cost ?? 0) + (item.estimated_profit_cost ?? 0))}</strong>
              <small>
                {formatCurrency(item.estimated_overhead_cost)} O/H · {formatCurrency(item.estimated_profit_cost)} profit
              </small>
            </div>
          </div>
        ) : null}
      </section>
    </FloatingPanel>
  )
}

export const TrackingTable = ({
  items,
  isSaving,
  onSaveRow,
  projectId,
  readOnly = false,
}: {
  items: ProjectItemMetric[]
  isSaving: string | null
  onSaveRow: (itemId: string, patch: ProjectItemActualUpdate) => Promise<void>
  projectId?: string
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
      new Map(
        items.map((item) => [item.project_estimate_item_id ?? item.item_code ?? '', item]),
      ),
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
          return [key, calculateTrackingDerived(drafts[key])]
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
        const sectionKey = `${item.section_code}:${item.section_name}`

        return {
          item,
          sectionKey,
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

  const renderBucketButton = (
    bucket: BucketKey,
    key: string,
    item: ProjectItemMetric,
    derived: TrackingDerived,
  ) => (
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
            const draft = drafts[key]
            const derived = derivedByKey[key]
            const sectionTotal = sectionTotals.get(sectionKey)
            const itemRoute =
              projectId && item.project_estimate_item_id
                ? '/projects/' + projectId + '/items/' + item.project_estimate_item_id
                : null

            if (!draft || !derived) {
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
                      {itemRoute ? (
                        <Link className="row-advanced-link" to={itemRoute}>
                          Advanced
                        </Link>
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
          item={itemsByKey.get(openBucket.itemId)!}
          onClose={handleCloseBucket}
          onCommit={() => {
            const activeItem = itemsByKey.get(openBucket.itemId)
            const activeDraft = drafts[openBucket.itemId]

            if (activeItem && activeDraft) {
              flushAutoSave(openBucket.itemId, activeDraft, activeItem)
            }
          }}
          onUpdateDraft={(field, value) => {
            updateDraft(openBucket.itemId, field, value)
          }}
          type={openBucket.bucket}
        />
      ) : null}
    </div>
  )
}
