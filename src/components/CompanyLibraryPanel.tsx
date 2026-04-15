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
  hideHeader?: boolean
  isBusy: boolean
  materials: OrganizationMaterialLibraryItem[]
  onCreateEmployee: (draft: {
    hourlyRate: number
    name: string
    role: string
  }) => Promise<OrganizationEmployeeLibraryItem | void>
  onCreateEquipment: (draft: {
    dailyRate: number
    name: string
  }) => Promise<OrganizationEquipmentLibraryItem | void>
  onCreateMaterial: (draft: {
    costPerUnit: number
    name: string
    unit: string
  }) => Promise<OrganizationMaterialLibraryItem | void>
  onDeleteEmployee: (itemId: string) => Promise<void>
  onDeleteEquipment: (itemId: string) => Promise<void>
  onDeleteMaterial: (itemId: string) => Promise<void>
  unitOptions: string[]
}

type LibraryTab = 'labor' | 'equipment' | 'materials'

export const CompanyLibraryPanel = ({
  employees,
  equipment,
  hideHeader = false,
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
  const [activeTab, setActiveTab] = useState<LibraryTab>('labor')
  const [employeeDraft, setEmployeeDraft] = useState(createEmptyCompanyEmployeeDraft)
  const [equipmentDraft, setEquipmentDraft] = useState(createEmptyCompanyEquipmentDraft)
  const [materialDraft, setMaterialDraft] = useState(createEmptyCompanyMaterialDraft)

  const availableUnits = useMemo(
    () =>
      {
        const nextUnits = Array.from(
        new Set(
          unitOptions
            .map((unit) => unit.trim().toUpperCase())
            .filter(Boolean),
        ),
      )

      return nextUnits.length > 0 ? nextUnits : ['EA']
      },
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

  const tabs = [
    {
      count: employees.length,
      key: 'labor' as const,
      label: 'Labor',
      title: 'Labor prefills',
      subtitle: 'Use roles, crews, or named employees to seed hourly rates.',
    },
    {
      count: equipment.length,
      key: 'equipment' as const,
      label: 'Equipment',
      title: 'Equipment prefills',
      subtitle: 'Keep lifts, trailers, and repeatable tools handy.',
    },
    {
      count: materials.length,
      key: 'materials' as const,
      label: 'Materials',
      title: 'Material prefills',
      subtitle: 'Store common roofing materials and unit pricing in one place.',
    },
  ]
  const activeTabMeta = tabs.find((tab) => tab.key === activeTab) ?? tabs[0]

  return (
    <article className="panel panel-compact company-library-panel">
      {!hideHeader ? (
        <div className="panel-heading panel-heading-compact">
          <div>
            <h2>Company library</h2>
            <p className="panel-meta">
              Only this company sees these prefills. Add your own roofing labor, equipment, and
              material defaults here.
            </p>
          </div>
        </div>
        ) : null}

      <div className="company-library-tabs" role="tablist" aria-label="Company library sections">
        {tabs.map((tab) => (
          <button
            aria-selected={tab.key === activeTab}
            className={'company-library-tab' + (tab.key === activeTab ? ' company-library-tab-active' : '')}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
          </button>
        ))}
      </div>

      <section className="company-library-sheet">
        <div className="company-library-sheet-header">
          <div>
            <h3>{activeTabMeta.title}</h3>
            <p className="panel-meta">{activeTabMeta.subtitle}</p>
          </div>
          <span className="section-count">{activeTabMeta.count}</span>
        </div>

        {activeTab === 'labor' ? (
          <>
            <form className="company-library-inline-form company-library-inline-form-labor" onSubmit={handleCreateEmployee}>
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
                Rate / hr
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
                Add labor
              </button>
            </form>

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
          </>
        ) : null}

        {activeTab === 'equipment' ? (
          <>
            <form className="company-library-inline-form company-library-inline-form-compact" onSubmit={handleCreateEquipment}>
              <label>
                Equipment
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
                Rate / day
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
          </>
        ) : null}

        {activeTab === 'materials' ? (
          <>
            <form className="company-library-inline-form company-library-inline-form-material" onSubmit={handleCreateMaterial}>
              <label>
                Material
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
          </>
        ) : null}
      </section>
    </article>
  )
}
