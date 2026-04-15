import type { Json } from './database.types'
import { calculateExtendedCost, deriveUnitCost, roundCurrencyValue } from './item-detail'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
  ProjectItemMetric,
} from './models'

export type LaborBreakdownEntry = {
  hourlyRate: number
  hours: number
  id: string
  libraryItemId: string | null
  name: string
  role: string | null
}

export type EquipmentBreakdownEntry = {
  dailyRate: number
  days: number
  id: string
  libraryItemId: string | null
  name: string
}

export type MaterialBreakdownEntry = {
  id: string
  libraryItemId: string | null
  name: string
  quantity: number
  unit: string
  unitCost: number
}

const roundValue = (value: number) => Math.round(value * 100) / 100

const createEntryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `mix-${Math.random().toString(36).slice(2, 10)}`

const isJsonRecord = (
  value: Json | null | undefined,
): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNumber = (value: Json | undefined) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const readString = (value: Json | undefined, fallback = '') =>
  typeof value === 'string' ? value : fallback

const readOptionalString = (value: Json | undefined) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const parseBreakdownList = <T>(
  value: Json | null | undefined,
  parser: (entry: { [key: string]: Json | undefined }) => T,
) => {
  if (!Array.isArray(value)) {
    return [] as T[]
  }

  return value
    .filter(isJsonRecord)
    .map((entry) => parser(entry))
}

export const createLaborBreakdownEntry = (
  overrides: Partial<LaborBreakdownEntry> = {},
): LaborBreakdownEntry => ({
  hourlyRate: roundValue(overrides.hourlyRate ?? 0),
  hours: roundValue(overrides.hours ?? 0),
  id: overrides.id ?? createEntryId(),
  libraryItemId: overrides.libraryItemId ?? null,
  name: overrides.name ?? 'Manual labor line',
  role: overrides.role ?? null,
})

export const createEquipmentBreakdownEntry = (
  overrides: Partial<EquipmentBreakdownEntry> = {},
): EquipmentBreakdownEntry => ({
  dailyRate: roundValue(overrides.dailyRate ?? 0),
  days: roundValue(overrides.days ?? 0),
  id: overrides.id ?? createEntryId(),
  libraryItemId: overrides.libraryItemId ?? null,
  name: overrides.name ?? 'Manual equipment line',
})

export const createMaterialBreakdownEntry = (
  overrides: Partial<MaterialBreakdownEntry> = {},
): MaterialBreakdownEntry => ({
  id: overrides.id ?? createEntryId(),
  libraryItemId: overrides.libraryItemId ?? null,
  name: overrides.name ?? 'Manual material line',
  quantity: roundValue(overrides.quantity ?? 0),
  unit: (overrides.unit ?? 'EA').trim().toUpperCase() || 'EA',
  unitCost: roundValue(overrides.unitCost ?? 0),
})

export const parseLaborBreakdown = (value: Json | null | undefined) =>
  parseBreakdownList(value, (entry) =>
    createLaborBreakdownEntry({
      hourlyRate: readNumber(entry.hourlyRate),
      hours: readNumber(entry.hours),
      id: readString(entry.id, createEntryId()),
      libraryItemId: readOptionalString(entry.libraryItemId),
      name: readString(entry.name, 'Manual labor line'),
      role: readOptionalString(entry.role),
    }),
  )

export const parseEquipmentBreakdown = (value: Json | null | undefined) =>
  parseBreakdownList(value, (entry) =>
    createEquipmentBreakdownEntry({
      dailyRate: readNumber(entry.dailyRate),
      days: readNumber(entry.days),
      id: readString(entry.id, createEntryId()),
      libraryItemId: readOptionalString(entry.libraryItemId),
      name: readString(entry.name, 'Manual equipment line'),
    }),
  )

export const parseMaterialBreakdown = (value: Json | null | undefined) =>
  parseBreakdownList(value, (entry) =>
    createMaterialBreakdownEntry({
      id: readString(entry.id, createEntryId()),
      libraryItemId: readOptionalString(entry.libraryItemId),
      name: readString(entry.name, 'Manual material line'),
      quantity: readNumber(entry.quantity),
      unit: readString(entry.unit, 'EA'),
      unitCost: readNumber(entry.unitCost),
    }),
  )

export const serializeLaborBreakdown = (entries: LaborBreakdownEntry[]): Json[] =>
  entries.map((entry) => ({
    hourlyRate: roundValue(entry.hourlyRate),
    hours: roundValue(entry.hours),
    id: entry.id,
    libraryItemId: entry.libraryItemId,
    name: entry.name.trim() || 'Manual labor line',
    role: entry.role?.trim() || null,
  }))

export const serializeEquipmentBreakdown = (
  entries: EquipmentBreakdownEntry[],
): Json[] =>
  entries.map((entry) => ({
    dailyRate: roundValue(entry.dailyRate),
    days: roundValue(entry.days),
    id: entry.id,
    libraryItemId: entry.libraryItemId,
    name: entry.name.trim() || 'Manual equipment line',
  }))

export const serializeMaterialBreakdown = (
  entries: MaterialBreakdownEntry[],
): Json[] =>
  entries.map((entry) => ({
    id: entry.id,
    libraryItemId: entry.libraryItemId,
    name: entry.name.trim() || 'Manual material line',
    quantity: roundValue(entry.quantity),
    unit: entry.unit.trim().toUpperCase() || 'EA',
    unitCost: roundValue(entry.unitCost),
  }))

const hasSerializedBreakdownChanged = (left: Json[], right: Json[]) =>
  JSON.stringify(left) !== JSON.stringify(right)

export const laborBreakdownChanged = (
  left: LaborBreakdownEntry[],
  right: LaborBreakdownEntry[],
) =>
  hasSerializedBreakdownChanged(
    serializeLaborBreakdown(left),
    serializeLaborBreakdown(right),
  )

export const equipmentBreakdownChanged = (
  left: EquipmentBreakdownEntry[],
  right: EquipmentBreakdownEntry[],
) =>
  hasSerializedBreakdownChanged(
    serializeEquipmentBreakdown(left),
    serializeEquipmentBreakdown(right),
  )

export const materialBreakdownChanged = (
  left: MaterialBreakdownEntry[],
  right: MaterialBreakdownEntry[],
) =>
  hasSerializedBreakdownChanged(
    serializeMaterialBreakdown(left),
    serializeMaterialBreakdown(right),
  )

export const calculateLaborBreakdownTotals = (entries: LaborBreakdownEntry[]) => {
  const hours = roundValue(entries.reduce((sum, entry) => sum + entry.hours, 0))
  const cost = roundCurrencyValue(
    entries.reduce(
      (sum, entry) => sum + calculateExtendedCost(entry.hours, entry.hourlyRate),
      0,
    ),
  )

  return {
    cost,
    hours,
    rate: deriveUnitCost(cost, hours),
  }
}

export const calculateEquipmentBreakdownTotals = (
  entries: EquipmentBreakdownEntry[],
) => {
  const days = roundValue(entries.reduce((sum, entry) => sum + entry.days, 0))
  const cost = roundCurrencyValue(
    entries.reduce(
      (sum, entry) => sum + calculateExtendedCost(entry.days, entry.dailyRate),
      0,
    ),
  )

  return {
    cost,
    days,
    rate: deriveUnitCost(cost, days),
  }
}

export const calculateMaterialBreakdownTotals = (
  entries: MaterialBreakdownEntry[],
) => ({
  cost: roundCurrencyValue(
    entries.reduce(
      (sum, entry) => sum + calculateExtendedCost(entry.quantity, entry.unitCost),
      0,
    ),
  ),
  quantity: roundValue(entries.reduce((sum, entry) => sum + entry.quantity, 0)),
})

export const createLaborBreakdownEntryFromEmployee = (
  employee: OrganizationEmployeeLibraryItem,
) =>
  createLaborBreakdownEntry({
    hourlyRate: employee.hourly_rate,
    libraryItemId: employee.id,
    name: employee.name,
    role: employee.role ?? null,
  })

export const createEquipmentBreakdownEntryFromEquipment = (
  equipment: OrganizationEquipmentLibraryItem,
) =>
  createEquipmentBreakdownEntry({
    dailyRate: equipment.daily_rate,
    libraryItemId: equipment.id,
    name: equipment.name,
  })

export const createMaterialBreakdownEntryFromMaterial = (
  material: OrganizationMaterialLibraryItem,
) =>
  createMaterialBreakdownEntry({
    libraryItemId: material.id,
    name: material.name,
    unit: material.unit,
    unitCost: material.cost_per_unit,
  })

export const getEstimateLaborBreakdown = (
  item: Pick<ProjectItemMetric, 'labor_breakdown' | 'labor_hours' | 'labor_rate'>,
) => {
  const parsed = parseLaborBreakdown(item.labor_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.labor_hours ?? 0) > 0 || (item.labor_rate ?? 0) > 0) {
    return [
      createLaborBreakdownEntry({
        hourlyRate: item.labor_rate ?? 0,
        hours: item.labor_hours ?? 0,
        name: 'Existing labor total',
      }),
    ]
  }

  return []
}

export const getEstimateEquipmentBreakdown = (
  item: Pick<ProjectItemMetric, 'equipment_breakdown' | 'equipment_days' | 'equipment_rate'>,
) => {
  const parsed = parseEquipmentBreakdown(item.equipment_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.equipment_days ?? 0) > 0 || (item.equipment_rate ?? 0) > 0) {
    return [
      createEquipmentBreakdownEntry({
        dailyRate: item.equipment_rate ?? 0,
        days: item.equipment_days ?? 0,
        name: 'Existing equipment total',
      }),
    ]
  }

  return []
}

export const getEstimateMaterialBreakdown = (
  item: Pick<ProjectItemMetric, 'material_breakdown' | 'material_cost' | 'quantity' | 'unit'>,
) => {
  const parsed = parseMaterialBreakdown(item.material_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.material_cost ?? 0) > 0 || (item.quantity ?? 0) > 0) {
    const fallbackQuantity =
      (item.quantity ?? 0) > 0 ? item.quantity ?? 0 : (item.material_cost ?? 0) > 0 ? 1 : 0

    return [
      createMaterialBreakdownEntry({
        name: 'Existing material total',
        quantity: fallbackQuantity,
        unit: item.unit ?? 'EA',
        unitCost: deriveUnitCost(item.material_cost ?? 0, fallbackQuantity),
      }),
    ]
  }

  return []
}

export const getActualLaborBreakdown = (
  item: Pick<
    ProjectItemMetric,
    'actual_labor_breakdown' | 'actual_labor_cost' | 'actual_labor_hours'
  >,
) => {
  const parsed = parseLaborBreakdown(item.actual_labor_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.actual_labor_hours ?? 0) > 0 || (item.actual_labor_cost ?? 0) > 0) {
    return [
      createLaborBreakdownEntry({
        hourlyRate: deriveUnitCost(
          item.actual_labor_cost ?? 0,
          item.actual_labor_hours ?? 0,
        ),
        hours: item.actual_labor_hours ?? 0,
        name: 'Existing actual labor',
      }),
    ]
  }

  return []
}

export const getActualEquipmentBreakdown = (
  item: Pick<
    ProjectItemMetric,
    'actual_equipment_breakdown' | 'actual_equipment_cost' | 'actual_equipment_days'
  >,
) => {
  const parsed = parseEquipmentBreakdown(item.actual_equipment_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.actual_equipment_days ?? 0) > 0 || (item.actual_equipment_cost ?? 0) > 0) {
    return [
      createEquipmentBreakdownEntry({
        dailyRate: deriveUnitCost(
          item.actual_equipment_cost ?? 0,
          item.actual_equipment_days ?? 0,
        ),
        days: item.actual_equipment_days ?? 0,
        name: 'Existing actual equipment',
      }),
    ]
  }

  return []
}

export const getActualMaterialBreakdown = (
  item: Pick<
    ProjectItemMetric,
    'actual_material_breakdown' | 'actual_material_cost' | 'actual_quantity' | 'unit'
  >,
) => {
  const parsed = parseMaterialBreakdown(item.actual_material_breakdown)

  if (parsed.length > 0) {
    return parsed
  }

  if ((item.actual_material_cost ?? 0) > 0 || (item.actual_quantity ?? 0) > 0) {
    const fallbackQuantity =
      (item.actual_quantity ?? 0) > 0
        ? item.actual_quantity ?? 0
        : (item.actual_material_cost ?? 0) > 0
          ? 1
          : 0

    return [
      createMaterialBreakdownEntry({
        name: 'Existing actual material',
        quantity: fallbackQuantity,
        unit: item.unit ?? 'EA',
        unitCost: deriveUnitCost(item.actual_material_cost ?? 0, fallbackQuantity),
      }),
    ]
  }

  return []
}

export const estimateLaborBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'labor_hours' | 'labor_rate'>,
  nextHours: number,
  nextRate: number,
) =>
  roundValue(item.labor_hours ?? 0) !== roundValue(nextHours) ||
  roundValue(item.labor_rate ?? 0) !== roundValue(nextRate)

export const estimateMaterialBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'material_cost' | 'quantity' | 'unit'>,
  nextQuantity: number,
  nextUnit: string,
  nextMaterialCost: number,
) =>
  roundValue(item.quantity ?? 0) !== roundValue(nextQuantity) ||
  (item.unit ?? 'EA').trim().toUpperCase() !== nextUnit.trim().toUpperCase() ||
  roundCurrencyValue(item.material_cost ?? 0) !== roundCurrencyValue(nextMaterialCost)

export const estimateEquipmentBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'equipment_days' | 'equipment_rate'>,
  nextDays: number,
  nextRate: number,
) =>
  roundValue(item.equipment_days ?? 0) !== roundValue(nextDays) ||
  roundValue(item.equipment_rate ?? 0) !== roundValue(nextRate)

export const actualLaborBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'actual_labor_cost' | 'actual_labor_hours'>,
  nextHours: number,
  nextCost: number,
) =>
  roundValue(item.actual_labor_hours ?? 0) !== roundValue(nextHours) ||
  roundCurrencyValue(item.actual_labor_cost ?? 0) !== roundCurrencyValue(nextCost)

export const actualMaterialBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'actual_material_cost' | 'actual_quantity'>,
  nextQuantity: number,
  nextCost: number,
) =>
  roundValue(item.actual_quantity ?? 0) !== roundValue(nextQuantity) ||
  roundCurrencyValue(item.actual_material_cost ?? 0) !== roundCurrencyValue(nextCost)

export const actualEquipmentBreakdownShouldReset = (
  item: Pick<ProjectItemMetric, 'actual_equipment_cost' | 'actual_equipment_days'>,
  nextDays: number,
  nextCost: number,
) =>
  roundValue(item.actual_equipment_days ?? 0) !== roundValue(nextDays) ||
  roundCurrencyValue(item.actual_equipment_cost ?? 0) !== roundCurrencyValue(nextCost)
