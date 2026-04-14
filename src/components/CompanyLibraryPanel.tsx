import { useMemo, useState, type FormEvent } from 'react'

import { formatCurrency } from '../lib/formatters'
import {
  createEmptyCompanyEmployeeDraft,
  createEmptyCompanyEquipmentDraft,
  createEmptyCompanyMaterialDraft,
  parseNumericInput,
} from '../lib/item-detail'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
} from '../lib/models'

type CompanyLibraryPanelProps = {
  employees: OrganizationEmployeeLibraryItem[]
  equipment: OrganizationEquipmentLibraryItem[]
  isBusy: boolean
  materials: OrganizationMaterialLibraryItem[]
  onCreateEmployee: (draft: { hourlyRate: number; name: string; role: string }) => Promise<void>
  onCreateEquipment: (draft: { dailyRate: number; name: string }) => Promise<void>
  onCreateMaterial: (draft: { costPerUnit: number; name: string; unit: string }) => Promise<void>
  onDeleteEmployee: (itemId: string) => Promise<void>
  onDeleteEquipment: (itemId: string) => Promise<void>
  onDeleteMaterial: (itemId: string) => Promise<void>
  unitOptions: string[]
}

export const CompanyLibraryPanel = ({
  employees,
  equipment,
  isBusy,
  materials,
  onCreateEmployee,
  onCreateEquipment,
  onCreateMaterial,
  onDeleteEmployee,
  onDeleteEquipment,
  onDeleteMaterial,
  unitOptions,
}: CompanyLibraryPanelProps) => {
  const [employeeDraft, setEmployeeDraft] = useState(createEmptyCompanyEmployeeDraft)
  const [equipmentDraft, setEquipmentDraft] = useState(createEmptyCompanyEquipmentDraft)
  const [materialDraft, setMaterialDraft] = useState(createEmptyCompanyMaterialDraft)

  const availableUnits = useMemo(
    () =>
      Array.from(
        new Set(
          unitOptions
            .map((unit) => unit.trim().toUpperCase())
            .filter(Boolean),
        ),
      ),
    [unitOptions],
  )

  const handleCreateEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!employeeDraft.name.trim()) {
      return
    }

    try {
      await onCreateEmployee({
        name: employeeDraft.name.trim(),
        role: employeeDraft.role.trim(),
        hourlyRate: parseNumericInput(employeeDraft.hourlyRate),
      })
      setEmployeeDraft(createEmptyCompanyEmployeeDraft())
    } catch {
      // Parent surfaces the error.
    }
  }

  const handleCreateEquipment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!equipmentDraft.name.trim()) {
      return
    }

    try {
      await onCreateEquipment({
        name: equipmentDraft.name.trim(),
        dailyRate: parseNumericInput(equipmentDraft.dailyRate),
      })
      setEquipmentDraft(createEmptyCompanyEquipmentDraft())
    } catch {
      // Parent surfaces the error.
    }
  }

  const handleCreateMaterial = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!materialDraft.name.trim() || !materialDraft.unit.trim()) {
      return
    }

    try {
      await onCreateMaterial({
        name: materialDraft.name.trim(),
        unit: materialDraft.unit.trim().toUpperCase(),
        costPerUnit: parseNumericInput(materialDraft.costPerUnit),
      })
      setMaterialDraft(createEmptyCompanyMaterialDraft())
    } catch {
      // Parent surfaces the error.
    }
  }

  return (
    <article className="panel panel-compact company-library-panel">
      <div className="panel-heading panel-heading-compact">
        <div>
          <h2>Company library</h2>
          <p className="panel-meta">
            Only this company sees these prefills. Add your own roofing labor, equipment, and
            material defaults here.
          </p>
        </div>
      </div>

      <div className="company-library-grid">
        <section className="company-library-card">
          <div className="company-library-card-header">
            <div>
              <h3>Employees + labor rates</h3>
              <p className="panel-meta">Use roles, crews, or named employees to seed hourly rates.</p>
            </div>
            <span className="section-count">{employees.length}</span>
          </div>

          <div className="company-library-list">
            {employees.length === 0 ? (
              <div className="panel-empty company-library-empty">No labor prefills yet.</div>
            ) : (
              employees.map((employee) => (
                <div className="company-library-row" key={employee.id}>
                  <div className="company-library-row-copy">
                    <strong>{employee.name}</strong>
                    <span>
                      {employee.role ? `${employee.role} · ` : ''}
                      {formatCurrency(employee.hourly_rate)} / hr
                    </span>
                  </div>
                  <button
                    className="ghost-button secondary-button-danger"
                    disabled={isBusy}
                    onClick={() => {
                      void onDeleteEmployee(employee.id).catch(() => undefined)
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          <form className="company-library-form company-library-form-employee" onSubmit={handleCreateEmployee}>
            <label>
              Name
              <input
                disabled={isBusy}
                onChange={(event) =>
                  setEmployeeDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Roof foreman"
                required
                type="text"
                value={employeeDraft.name}
              />
            </label>
            <label>
              Role
              <input
                disabled={isBusy}
                onChange={(event) =>
                  setEmployeeDraft((current) => ({ ...current, role: event.target.value }))
                }
                placeholder="Install crew"
                type="text"
                value={employeeDraft.role}
              />
            </label>
            <label>
              Hourly rate
              <input
                disabled={isBusy}
                min="0"
                onChange={(event) =>
                  setEmployeeDraft((current) => ({ ...current, hourlyRate: event.target.value }))
                }
                step="0.01"
                type="number"
                value={employeeDraft.hourlyRate}
              />
            </label>
            <button className="primary-button" disabled={isBusy} type="submit">
              Add labor prefill
            </button>
          </form>
        </section>

        <section className="company-library-card">
          <div className="company-library-card-header">
            <div>
              <h3>Equipment</h3>
              <p className="panel-meta">Store daily rates for the lifts, trailers, and tools you reuse.</p>
            </div>
            <span className="section-count">{equipment.length}</span>
          </div>

          <div className="company-library-list">
            {equipment.length === 0 ? (
              <div className="panel-empty company-library-empty">No equipment prefills yet.</div>
            ) : (
              equipment.map((item) => (
                <div className="company-library-row" key={item.id}>
                  <div className="company-library-row-copy">
                    <strong>{item.name}</strong>
                    <span>{formatCurrency(item.daily_rate)} / day</span>
                  </div>
                  <button
                    className="ghost-button secondary-button-danger"
                    disabled={isBusy}
                    onClick={() => {
                      void onDeleteEquipment(item.id).catch(() => undefined)
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          <form className="company-library-form company-library-form-compact" onSubmit={handleCreateEquipment}>
            <label>
              Equipment name
              <input
                disabled={isBusy}
                onChange={(event) =>
                  setEquipmentDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Dump trailer"
                required
                type="text"
                value={equipmentDraft.name}
              />
            </label>
            <label>
              Daily rate
              <input
                disabled={isBusy}
                min="0"
                onChange={(event) =>
                  setEquipmentDraft((current) => ({ ...current, dailyRate: event.target.value }))
                }
                step="0.01"
                type="number"
                value={equipmentDraft.dailyRate}
              />
            </label>
            <button className="primary-button" disabled={isBusy} type="submit">
              Add equipment
            </button>
          </form>
        </section>

        <section className="company-library-card">
          <div className="company-library-card-header">
            <div>
              <h3>Materials</h3>
              <p className="panel-meta">Keep common roofing materials and unit pricing on hand.</p>
            </div>
            <span className="section-count">{materials.length}</span>
          </div>

          <div className="company-library-list">
            {materials.length === 0 ? (
              <div className="panel-empty company-library-empty">No material prefills yet.</div>
            ) : (
              materials.map((material) => (
                <div className="company-library-row" key={material.id}>
                  <div className="company-library-row-copy">
                    <strong>{material.name}</strong>
                    <span>
                      {material.unit} · {formatCurrency(material.cost_per_unit)} / unit
                    </span>
                  </div>
                  <button
                    className="ghost-button secondary-button-danger"
                    disabled={isBusy}
                    onClick={() => {
                      void onDeleteMaterial(material.id).catch(() => undefined)
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          <form className="company-library-form company-library-form-material" onSubmit={handleCreateMaterial}>
            <label>
              Material name
              <input
                disabled={isBusy}
                onChange={(event) =>
                  setMaterialDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Architectural shingles"
                required
                type="text"
                value={materialDraft.name}
              />
            </label>
            <label>
              Unit
              <select
                className="item-detail-select"
                disabled={isBusy}
                onChange={(event) =>
                  setMaterialDraft((current) => ({ ...current, unit: event.target.value }))
                }
                value={materialDraft.unit}
              >
                {availableUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cost / unit
              <input
                disabled={isBusy}
                min="0"
                onChange={(event) =>
                  setMaterialDraft((current) => ({ ...current, costPerUnit: event.target.value }))
                }
                step="0.01"
                type="number"
                value={materialDraft.costPerUnit}
              />
            </label>
            <button className="primary-button" disabled={isBusy} type="submit">
              Add material
            </button>
          </form>
        </section>
      </div>
    </article>
  )
}
