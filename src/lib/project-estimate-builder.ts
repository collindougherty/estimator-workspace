import {
  calculateActualOverheadCost,
  deriveUnitCost,
  parseNumericInput,
  roundCurrencyValue,
} from './item-detail'
import type { ProjectEstimateItemUpdate, ProjectItemMetric } from './models'
import {
  calculateEquipmentBreakdownTotals,
  calculateLaborBreakdownTotals,
  calculateMaterialBreakdownTotals,
  equipmentBreakdownChanged,
  getEstimateEquipmentBreakdown,
  getEstimateLaborBreakdown,
  getEstimateMaterialBreakdown,
  laborBreakdownChanged,
  materialBreakdownChanged,
  serializeEquipmentBreakdown,
  serializeLaborBreakdown,
  serializeMaterialBreakdown,
  type EquipmentBreakdownEntry,
  type LaborBreakdownEntry,
  type MaterialBreakdownEntry,
} from './resource-breakdowns'

export type EstimateBuilderDraft = {
  equipmentBreakdown: EquipmentBreakdownEntry[]
  isIncluded: boolean
  itemName: string
  laborBreakdown: LaborBreakdownEntry[]
  materialBreakdown: MaterialBreakdownEntry[]
  overheadPercent: string
  profitPercent: string
  quantity: string
  subcontractCost: string
  unit: string
}

export type EstimateBuilderDerived = {
  directCost: number
  equipmentCost: number
  equipmentDays: number
  equipmentRate: number
  laborCost: number
  laborHours: number
  laborRate: number
  materialCost: number
  materialCostPerUnit: number
  overheadCost: number
  overheadPercent: number
  profitCost: number
  profitPercent: number
  quantity: number
  subcontractCost: number
  totalCost: number
}

const resolveNumericPatchValue = (
  patchValue: number | null | undefined,
  fallbackValue: number | null | undefined,
) => (typeof patchValue === 'number' ? patchValue : fallbackValue ?? 0)

const normalizeUnit = (value: string) => value.trim().toUpperCase() || 'EA'

export const toEstimateBuilderDraft = (item: ProjectItemMetric): EstimateBuilderDraft => ({
  equipmentBreakdown: getEstimateEquipmentBreakdown(item),
  isIncluded: item.is_included ?? false,
  itemName: item.item_name ?? '',
  laborBreakdown: getEstimateLaborBreakdown(item),
  materialBreakdown: getEstimateMaterialBreakdown(item),
  overheadPercent: String(item.overhead_percent ?? 0),
  profitPercent: String(item.profit_percent ?? 0),
  quantity: String(item.quantity ?? 0),
  subcontractCost: String(item.subcontract_cost ?? 0),
  unit: normalizeUnit(item.unit ?? 'EA'),
})

export const calculateEstimateBuilderDerived = (
  draft: EstimateBuilderDraft,
): EstimateBuilderDerived => {
  const quantity = parseNumericInput(draft.quantity)
  const laborTotals = calculateLaborBreakdownTotals(draft.laborBreakdown)
  const equipmentTotals = calculateEquipmentBreakdownTotals(draft.equipmentBreakdown)
  const materialTotals = calculateMaterialBreakdownTotals(draft.materialBreakdown)
  const subcontractCost = parseNumericInput(draft.subcontractCost)
  const overheadPercent = parseNumericInput(draft.overheadPercent)
  const profitPercent = parseNumericInput(draft.profitPercent)
  const directCost = roundCurrencyValue(
    laborTotals.cost + materialTotals.cost + equipmentTotals.cost + subcontractCost,
  )
  const overheadCost = calculateActualOverheadCost(directCost, overheadPercent)
  const profitCost = calculateActualOverheadCost(directCost, profitPercent)

  return {
    directCost,
    equipmentCost: equipmentTotals.cost,
    equipmentDays: equipmentTotals.days,
    equipmentRate: equipmentTotals.rate,
    laborCost: laborTotals.cost,
    laborHours: laborTotals.hours,
    laborRate: laborTotals.rate,
    materialCost: materialTotals.cost,
    materialCostPerUnit: deriveUnitCost(materialTotals.cost, quantity),
    overheadCost,
    overheadPercent,
    profitCost,
    profitPercent,
    quantity,
    subcontractCost,
    totalCost: roundCurrencyValue(directCost + overheadCost + profitCost),
  }
}

export const isEstimateBuilderDraftDirty = (
  draft: EstimateBuilderDraft,
  item: ProjectItemMetric,
) => {
  const baseline = toEstimateBuilderDraft(item)

  return (
    draft.isIncluded !== baseline.isIncluded ||
    draft.itemName !== baseline.itemName ||
    parseNumericInput(draft.quantity) !== parseNumericInput(baseline.quantity) ||
    normalizeUnit(draft.unit) !== normalizeUnit(baseline.unit) ||
    parseNumericInput(draft.subcontractCost) !== parseNumericInput(baseline.subcontractCost) ||
    parseNumericInput(draft.overheadPercent) !== parseNumericInput(baseline.overheadPercent) ||
    parseNumericInput(draft.profitPercent) !== parseNumericInput(baseline.profitPercent) ||
    laborBreakdownChanged(draft.laborBreakdown, baseline.laborBreakdown) ||
    materialBreakdownChanged(draft.materialBreakdown, baseline.materialBreakdown) ||
    equipmentBreakdownChanged(draft.equipmentBreakdown, baseline.equipmentBreakdown)
  )
}

export const toProjectEstimateItemPatch = (
  draft: EstimateBuilderDraft,
): ProjectEstimateItemUpdate => {
  const derived = calculateEstimateBuilderDerived(draft)

  return {
    equipment_breakdown: serializeEquipmentBreakdown(draft.equipmentBreakdown),
    equipment_days: derived.equipmentDays,
    equipment_rate: derived.equipmentRate,
    is_included: draft.isIncluded,
    item_name: draft.itemName.trim(),
    labor_breakdown: serializeLaborBreakdown(draft.laborBreakdown),
    labor_hours: derived.laborHours,
    labor_rate: derived.laborRate,
    material_breakdown: serializeMaterialBreakdown(draft.materialBreakdown),
    material_cost: derived.materialCost,
    overhead_percent: derived.overheadPercent,
    profit_percent: derived.profitPercent,
    quantity: derived.quantity,
    subcontract_cost: derived.subcontractCost,
    unit: normalizeUnit(draft.unit),
  }
}

export const applyEstimatePatchToProjectItemMetric = (
  item: ProjectItemMetric,
  patch: ProjectEstimateItemUpdate,
): ProjectItemMetric => {
  const quantity = resolveNumericPatchValue(patch.quantity, item.quantity)
  const laborHours = resolveNumericPatchValue(patch.labor_hours, item.labor_hours)
  const laborRate = resolveNumericPatchValue(patch.labor_rate, item.labor_rate)
  const materialCost = resolveNumericPatchValue(patch.material_cost, item.material_cost)
  const equipmentDays = resolveNumericPatchValue(patch.equipment_days, item.equipment_days)
  const equipmentRate = resolveNumericPatchValue(patch.equipment_rate, item.equipment_rate)
  const subcontractCost = resolveNumericPatchValue(patch.subcontract_cost, item.subcontract_cost)
  const overheadPercent = resolveNumericPatchValue(
    patch.overhead_percent,
    item.overhead_percent,
  )
  const profitPercent = resolveNumericPatchValue(patch.profit_percent, item.profit_percent)
  const laborCost = roundCurrencyValue(laborHours * laborRate)
  const equipmentCost = roundCurrencyValue(equipmentDays * equipmentRate)
  const directCost = roundCurrencyValue(
    laborCost + materialCost + equipmentCost + subcontractCost,
  )
  const overheadCost = calculateActualOverheadCost(directCost, overheadPercent)
  const profitCost = calculateActualOverheadCost(directCost, profitPercent)

  return {
    ...item,
    equipment_breakdown:
      patch.equipment_breakdown ?? item.equipment_breakdown,
    equipment_days: equipmentDays,
    equipment_rate: equipmentRate,
    estimated_equipment_cost: equipmentCost,
    estimated_labor_cost: laborCost,
    estimated_overhead_cost: overheadCost,
    estimated_profit_cost: profitCost,
    estimated_total_cost: roundCurrencyValue(directCost + overheadCost + profitCost),
    is_included:
      typeof patch.is_included === 'boolean' ? patch.is_included : item.is_included,
    item_name: patch.item_name ?? item.item_name,
    labor_breakdown: patch.labor_breakdown ?? item.labor_breakdown,
    labor_hours: laborHours,
    labor_rate: laborRate,
    material_breakdown: patch.material_breakdown ?? item.material_breakdown,
    material_cost: materialCost,
    overhead_percent: overheadPercent,
    profit_percent: profitPercent,
    quantity,
    subcontract_cost: subcontractCost,
    unit: patch.unit ?? item.unit,
  }
}
