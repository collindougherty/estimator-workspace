import type { Tables, TablesInsert, TablesUpdate } from './database.types'

export type Organization = Tables<'organizations'>
export type OrganizationEmployeeLibraryItem = Tables<'organization_employee_library'>
export type OrganizationEmployeeLibraryItemInsert = TablesInsert<'organization_employee_library'>
export type OrganizationEmployeeLibraryItemUpdate = TablesUpdate<'organization_employee_library'>
export type OrganizationEquipmentLibraryItem = Tables<'organization_equipment_library'>
export type OrganizationEquipmentLibraryItemInsert = TablesInsert<'organization_equipment_library'>
export type OrganizationEquipmentLibraryItemUpdate = TablesUpdate<'organization_equipment_library'>
export type OrganizationMaterialLibraryItem = Tables<'organization_material_library'>
export type OrganizationMaterialLibraryItemInsert = TablesInsert<'organization_material_library'>
export type OrganizationMaterialLibraryItemUpdate = TablesUpdate<'organization_material_library'>
export type Profile = Tables<'profiles'>
export type ProjectSummary = Tables<'project_summary'>
export type ProjectItemMetric = Tables<'project_item_metrics'>
export type ContractorPreset = Tables<'contractor_presets'>
export type PresetWbsItem = Tables<'preset_wbs_items'>
export type ProjectEstimateItemUpdate = TablesUpdate<'project_estimate_items'>
export type ProjectItemActualUpdate = TablesUpdate<'project_item_actuals'>

export type ProjectStatus = NonNullable<ProjectSummary['status']>

export type ProjectGrouping = {
  label: string
  statuses: ProjectStatus[]
}

export type EstimateDraft = {
  is_included: boolean
  item_name: string
  quantity: string
  labor_hours: string
  labor_rate: string
  material_cost: string
  equipment_days: string
  equipment_rate: string
  subcontract_cost: string
  overhead_percent: string
  profit_percent: string
}

export const projectGroups: ProjectGrouping[] = [
  {
    label: 'Bids',
    statuses: ['draft', 'bidding', 'submitted', 'won'],
  },
  {
    label: 'Active work',
    statuses: ['active'],
  },
  {
    label: 'Closed',
    statuses: ['completed', 'lost', 'archived'],
  },
]

export const toEstimateDraft = (item: ProjectItemMetric): EstimateDraft => ({
  is_included: item.is_included ?? false,
  item_name: item.item_name ?? '',
  quantity: String(item.quantity ?? 0),
  labor_hours: String(item.labor_hours ?? 0),
  labor_rate: String(item.labor_rate ?? 0),
  material_cost: String(item.material_cost ?? 0),
  equipment_days: String(item.equipment_days ?? 0),
  equipment_rate: String(item.equipment_rate ?? 0),
  subcontract_cost: String(item.subcontract_cost ?? 0),
  overhead_percent: String(item.overhead_percent ?? 0),
  profit_percent: String(item.profit_percent ?? 0),
})

export const metricFieldMap: Record<
  Exclude<keyof EstimateDraft, 'is_included'>,
  keyof ProjectEstimateItemUpdate
> = {
  item_name: 'item_name',
  quantity: 'quantity',
  labor_hours: 'labor_hours',
  labor_rate: 'labor_rate',
  material_cost: 'material_cost',
  equipment_days: 'equipment_days',
  equipment_rate: 'equipment_rate',
  subcontract_cost: 'subcontract_cost',
  overhead_percent: 'overhead_percent',
  profit_percent: 'profit_percent',
}

export const numericDraftFields: Array<
  Exclude<keyof EstimateDraft, 'is_included' | 'item_name'>
> = [
  'quantity',
  'labor_hours',
  'labor_rate',
  'material_cost',
  'equipment_days',
  'equipment_rate',
  'subcontract_cost',
  'overhead_percent',
  'profit_percent',
]
