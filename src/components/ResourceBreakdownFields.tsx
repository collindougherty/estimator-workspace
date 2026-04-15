import { useRef } from 'react'

import { formatCurrency, formatNumber } from '../lib/formatters'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
} from '../lib/models'
import type {
  EquipmentBreakdownEntry,
  LaborBreakdownEntry,
  MaterialBreakdownEntry,
} from '../lib/resource-breakdowns'
import {
  calculateEquipmentBreakdownTotals,
  calculateLaborBreakdownTotals,
  calculateMaterialBreakdownTotals,
} from '../lib/resource-breakdowns'

const readNumericField = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`

const normalizeLibraryName = (value: string) => value.trim().toLowerCase()

const findEmployeeMatch = (
  employees: OrganizationEmployeeLibraryItem[],
  value: string,
) => {
  const needle = normalizeLibraryName(value)

  if (!needle) {
    return null
  }

  return employees.find((employee) => normalizeLibraryName(employee.name) === needle) ?? null
}

const findEquipmentMatch = (
  equipment: OrganizationEquipmentLibraryItem[],
  value: string,
) => {
  const needle = normalizeLibraryName(value)

  if (!needle) {
    return null
  }

  return equipment.find((equipmentItem) => normalizeLibraryName(equipmentItem.name) === needle) ?? null
}

const findMaterialMatch = (
  materials: OrganizationMaterialLibraryItem[],
  value: string,
) => {
  const needle = normalizeLibraryName(value)

  if (!needle) {
    return null
  }

  return materials.find((material) => normalizeLibraryName(material.name) === needle) ?? null
}

const TableHeader = ({
  className,
  labels,
}: {
  className: string
  labels: string[]
}) => (
  <div className={`resource-mix-table-head ${className}`}>
    {labels.map((label, index) => (
      <span aria-hidden={label === ''} key={`${className}-${index}`}>
        {label}
      </span>
    ))}
  </div>
)

export const LaborBreakdownFields = ({
  employees = [],
  entries,
  onAddManual,
  onCreateLibraryItem,
  onRemove,
  onUpdate,
}: {
  employees?: OrganizationEmployeeLibraryItem[]
  entries: LaborBreakdownEntry[]
  onAddManual: () => void
  onCreateLibraryItem?: (draft: {
    hourlyRate: number
    name: string
    role: string
  }) => Promise<OrganizationEmployeeLibraryItem | void>
  onRemove: (id: string) => void
  onUpdate: (
    id: string,
    patch: Partial<LaborBreakdownEntry>,
    persistImmediately?: boolean,
  ) => void
}) => {
  const pendingCreateIds = useRef(new Set<string>())
  const totals = calculateLaborBreakdownTotals(entries)
  const summary =
    entries.length === 0
      ? 'No crew lines yet'
      : `${pluralize(entries.length, 'line')} · ${formatNumber(totals.hours)} hrs`

  const syncLibraryEntry = async (entry: LaborBreakdownEntry) => {
    const trimmedName = entry.name.trim()

    if (!trimmedName) {
      return
    }

    const matchedEmployee = findEmployeeMatch(employees, trimmedName)

    if (matchedEmployee) {
      onUpdate(
        entry.id,
        {
          hourlyRate: matchedEmployee.hourly_rate,
          libraryItemId: matchedEmployee.id,
          name: matchedEmployee.name,
          role: matchedEmployee.role,
        },
        true,
      )
      return
    }

    if (
      !onCreateLibraryItem ||
      entry.libraryItemId ||
      entry.hourlyRate <= 0 ||
      pendingCreateIds.current.has(entry.id)
    ) {
      return
    }

    pendingCreateIds.current.add(entry.id)

    try {
      const createdEntry = await onCreateLibraryItem({
        hourlyRate: entry.hourlyRate,
        name: trimmedName,
        role: entry.role?.trim() ?? '',
      })

      if (!createdEntry) {
        return
      }

      onUpdate(
        entry.id,
        {
          hourlyRate: createdEntry.hourly_rate,
          libraryItemId: createdEntry.id,
          name: createdEntry.name,
          role: createdEntry.role,
        },
        true,
      )
    } finally {
      pendingCreateIds.current.delete(entry.id)
    }
  }

  return (
    <section className="resource-mix-section">
      <div className="resource-mix-section-header">
        <div>
          <h3>Crew mix</h3>
          <p>{summary}</p>
        </div>
        <button className="secondary-button resource-mix-add-button" onClick={onAddManual} type="button">
          Manual line
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="resource-mix-empty">Tap a company prefill or add one manual line.</div>
      ) : (
        <div className="resource-mix-table-shell">
          <datalist id="resource-labor-library-options">
            {employees.map((employee) => (
              <option
                key={employee.id}
                label={[
                  employee.role?.trim() || null,
                  `${formatCurrency(employee.hourly_rate)} / hr`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={employee.name}
              />
            ))}
          </datalist>
          <TableHeader
            className="resource-mix-table-head-labor"
            labels={['Worker', 'Hours', 'Rate / hr', 'Total', '']}
          />
          {entries.map((entry) => (
            <div className="resource-mix-row resource-mix-row-labor" key={entry.id}>
              <label className="resource-sheet-field resource-mix-cell resource-mix-primary-cell">
                <span className="resource-mix-cell-label">Worker</span>
                <input
                  aria-label="Worker"
                  list="resource-labor-library-options"
                  onBlur={(event) => {
                    void syncLibraryEntry({ ...entry, name: event.target.value })
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, {
                      libraryItemId: null,
                      name: event.target.value,
                      role: entry.libraryItemId ? null : entry.role,
                    })
                  }
                  type="text"
                  value={entry.name}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Hours</span>
                <input
                  aria-label="Hours"
                  min="0"
                  onChange={(event) => onUpdate(entry.id, { hours: readNumericField(event.target.value) })}
                  step="0.1"
                  type="number"
                  value={entry.hours}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Rate / hr</span>
                <input
                  aria-label="Rate / hr"
                  min="0"
                  onBlur={() => {
                    void syncLibraryEntry(entry)
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, { hourlyRate: readNumericField(event.target.value) })
                  }
                  step="0.01"
                  type="number"
                  value={entry.hourlyRate}
                />
              </label>

              <div className="resource-mix-total">
                <span>Total</span>
                <strong>{formatCurrency(entry.hours * entry.hourlyRate)}</strong>
              </div>

              <div className="resource-mix-row-action">
                <button className="resource-mix-remove" onClick={() => onRemove(entry.id)} type="button">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export const EquipmentBreakdownFields = ({
  equipment = [],
  entries,
  onAddManual,
  onCreateLibraryItem,
  onRemove,
  onUpdate,
}: {
  equipment?: OrganizationEquipmentLibraryItem[]
  entries: EquipmentBreakdownEntry[]
  onAddManual: () => void
  onCreateLibraryItem?: (draft: {
    dailyRate: number
    name: string
  }) => Promise<OrganizationEquipmentLibraryItem | void>
  onRemove: (id: string) => void
  onUpdate: (
    id: string,
    patch: Partial<EquipmentBreakdownEntry>,
    persistImmediately?: boolean,
  ) => void
}) => {
  const pendingCreateIds = useRef(new Set<string>())
  const totals = calculateEquipmentBreakdownTotals(entries)
  const summary =
    entries.length === 0
      ? 'No equipment lines yet'
      : `${pluralize(entries.length, 'line')} · ${formatNumber(totals.days)} days`

  const syncLibraryEntry = async (entry: EquipmentBreakdownEntry) => {
    const trimmedName = entry.name.trim()

    if (!trimmedName) {
      return
    }

    const matchedEquipment = findEquipmentMatch(equipment, trimmedName)

    if (matchedEquipment) {
      onUpdate(
        entry.id,
        {
          dailyRate: matchedEquipment.daily_rate,
          libraryItemId: matchedEquipment.id,
          name: matchedEquipment.name,
        },
        true,
      )
      return
    }

    if (
      !onCreateLibraryItem ||
      entry.libraryItemId ||
      entry.dailyRate <= 0 ||
      pendingCreateIds.current.has(entry.id)
    ) {
      return
    }

    pendingCreateIds.current.add(entry.id)

    try {
      const createdEntry = await onCreateLibraryItem({
        dailyRate: entry.dailyRate,
        name: trimmedName,
      })

      if (!createdEntry) {
        return
      }

      onUpdate(
        entry.id,
        {
          dailyRate: createdEntry.daily_rate,
          libraryItemId: createdEntry.id,
          name: createdEntry.name,
        },
        true,
      )
    } finally {
      pendingCreateIds.current.delete(entry.id)
    }
  }

  return (
    <section className="resource-mix-section">
      <div className="resource-mix-section-header">
        <div>
          <h3>Equipment mix</h3>
          <p>{summary}</p>
        </div>
        <button className="secondary-button resource-mix-add-button" onClick={onAddManual} type="button">
          Manual line
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="resource-mix-empty">Tap a company prefill or add one manual line.</div>
      ) : (
        <div className="resource-mix-table-shell">
          <datalist id="resource-equipment-library-options">
            {equipment.map((equipmentItem) => (
              <option
                key={equipmentItem.id}
                label={`${formatCurrency(equipmentItem.daily_rate)} / day`}
                value={equipmentItem.name}
              />
            ))}
          </datalist>
          <TableHeader
            className="resource-mix-table-head-equipment"
            labels={['Equipment', 'Days', 'Rate / day', 'Total', '']}
          />
          {entries.map((entry) => (
            <div className="resource-mix-row resource-mix-row-equipment" key={entry.id}>
              <label className="resource-sheet-field resource-mix-cell resource-mix-primary-cell">
                <span className="resource-mix-cell-label">Equipment</span>
                <input
                  aria-label="Equipment"
                  list="resource-equipment-library-options"
                  onBlur={(event) => {
                    void syncLibraryEntry({ ...entry, name: event.target.value })
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, { libraryItemId: null, name: event.target.value })
                  }
                  type="text"
                  value={entry.name}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Days</span>
                <input
                  aria-label="Days"
                  min="0"
                  onChange={(event) => onUpdate(entry.id, { days: readNumericField(event.target.value) })}
                  step="0.1"
                  type="number"
                  value={entry.days}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Rate / day</span>
                <input
                  aria-label="Rate / day"
                  min="0"
                  onBlur={() => {
                    void syncLibraryEntry(entry)
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, { dailyRate: readNumericField(event.target.value) })
                  }
                  step="0.01"
                  type="number"
                  value={entry.dailyRate}
                />
              </label>

              <div className="resource-mix-total">
                <span>Total</span>
                <strong>{formatCurrency(entry.days * entry.dailyRate)}</strong>
              </div>

              <div className="resource-mix-row-action">
                <button className="resource-mix-remove" onClick={() => onRemove(entry.id)} type="button">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export const MaterialBreakdownFields = ({
  materials = [],
  entries,
  onAddManual,
  onCreateLibraryItem,
  onRemove,
  onUpdate,
}: {
  materials?: OrganizationMaterialLibraryItem[]
  entries: MaterialBreakdownEntry[]
  onAddManual: () => void
  onCreateLibraryItem?: (draft: {
    costPerUnit: number
    name: string
    unit: string
  }) => Promise<OrganizationMaterialLibraryItem | void>
  onRemove: (id: string) => void
  onUpdate: (
    id: string,
    patch: Partial<MaterialBreakdownEntry>,
    persistImmediately?: boolean,
  ) => void
}) => {
  const pendingCreateIds = useRef(new Set<string>())
  const totals = calculateMaterialBreakdownTotals(entries)
  const summary =
    entries.length === 0
      ? 'No material selections yet'
      : `${pluralize(entries.length, 'selection')} · ${formatCurrency(totals.cost)}`

  const syncLibraryEntry = async (entry: MaterialBreakdownEntry) => {
    const trimmedName = entry.name.trim()
    const trimmedUnit = entry.unit.trim().toUpperCase()

    if (!trimmedName) {
      return
    }

    const matchedMaterial = findMaterialMatch(materials, trimmedName)

    if (matchedMaterial) {
      onUpdate(
        entry.id,
        {
          libraryItemId: matchedMaterial.id,
          name: matchedMaterial.name,
          unit: matchedMaterial.unit,
          unitCost: matchedMaterial.cost_per_unit,
        },
        true,
      )
      return
    }

    if (
      !onCreateLibraryItem ||
      entry.libraryItemId ||
      !trimmedUnit ||
      entry.unitCost <= 0 ||
      pendingCreateIds.current.has(entry.id)
    ) {
      return
    }

    pendingCreateIds.current.add(entry.id)

    try {
      const createdEntry = await onCreateLibraryItem({
        costPerUnit: entry.unitCost,
        name: trimmedName,
        unit: trimmedUnit,
      })

      if (!createdEntry) {
        return
      }

      onUpdate(
        entry.id,
        {
          libraryItemId: createdEntry.id,
          name: createdEntry.name,
          unit: createdEntry.unit,
          unitCost: createdEntry.cost_per_unit,
        },
        true,
      )
    } finally {
      pendingCreateIds.current.delete(entry.id)
    }
  }

  return (
    <section className="resource-mix-section">
      <div className="resource-mix-section-header">
        <div>
          <h3>Material selections</h3>
          <p>{summary}</p>
        </div>
        <button className="secondary-button resource-mix-add-button" onClick={onAddManual} type="button">
          Manual line
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="resource-mix-empty">Tap a company prefill or add one manual line.</div>
      ) : (
        <div className="resource-mix-table-shell">
          <datalist id="resource-material-library-options">
            {materials.map((material) => (
              <option
                key={material.id}
                label={`${material.unit} · ${formatCurrency(material.cost_per_unit)} / unit`}
                value={material.name}
              />
            ))}
          </datalist>
          <TableHeader
            className="resource-mix-table-head-materials"
            labels={['Material', 'Qty', 'Unit', 'Cost / unit', 'Total', '']}
          />
          {entries.map((entry) => (
            <div className="resource-mix-row resource-mix-row-materials" key={entry.id}>
              <label className="resource-sheet-field resource-mix-cell resource-mix-primary-cell">
                <span className="resource-mix-cell-label">Material</span>
                <input
                  aria-label="Material"
                  list="resource-material-library-options"
                  onBlur={(event) => {
                    void syncLibraryEntry({ ...entry, name: event.target.value })
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, { libraryItemId: null, name: event.target.value })
                  }
                  type="text"
                  value={entry.name}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Quantity</span>
                <input
                  aria-label="Quantity"
                  min="0"
                  onChange={(event) =>
                    onUpdate(entry.id, { quantity: readNumericField(event.target.value) })
                  }
                  step="0.1"
                  type="number"
                  value={entry.quantity}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Unit</span>
                <input
                  aria-label="Unit"
                  onBlur={() => {
                    void syncLibraryEntry(entry)
                  }}
                  onChange={(event) => onUpdate(entry.id, { unit: event.target.value.toUpperCase() })}
                  type="text"
                  value={entry.unit}
                />
              </label>

              <label className="resource-sheet-field resource-mix-cell">
                <span className="resource-mix-cell-label">Cost / unit</span>
                <input
                  aria-label="Cost / unit"
                  min="0"
                  onBlur={() => {
                    void syncLibraryEntry(entry)
                  }}
                  onChange={(event) =>
                    onUpdate(entry.id, { unitCost: readNumericField(event.target.value) })
                  }
                  step="0.01"
                  type="number"
                  value={entry.unitCost}
                />
              </label>

              <div className="resource-mix-total">
                <span>Total</span>
                <strong>{formatCurrency(entry.quantity * entry.unitCost)}</strong>
              </div>

              <div className="resource-mix-row-action">
                <button className="resource-mix-remove" onClick={() => onRemove(entry.id)} type="button">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
