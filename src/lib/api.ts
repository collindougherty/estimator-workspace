import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'
import type {
  ContractorPreset,
  Organization,
  OrganizationEmployeeLibraryItem,
  OrganizationEmployeeLibraryItemInsert,
  OrganizationEmployeeLibraryItemUpdate,
  OrganizationEquipmentLibraryItem,
  OrganizationEquipmentLibraryItemInsert,
  OrganizationEquipmentLibraryItemUpdate,
  OrganizationMaterialLibraryItem,
  OrganizationMaterialLibraryItemInsert,
  OrganizationMaterialLibraryItemUpdate,
  PresetWbsItem,
  Profile,
  ProjectEstimateItemUpdate,
  ProjectItemActualUpdate,
  ProjectItemMetric,
  ProjectStatus,
  ProjectSummary,
} from './models'

const throwOnError = (error: { message: string } | null) => {
  if (error) {
    throw new Error(error.message)
  }
}

export const signInWithPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  throwOnError(error)

  return data
}

export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  throwOnError(error)
}

export const getSession = async (): Promise<Session | null> => {
  const { data, error } = await supabase.auth.getSession()
  throwOnError(error)
  return data.session
}

export const fetchProfile = async (userId: string): Promise<Profile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  throwOnError(error)
  return data
}

export const fetchOrganizations = async (): Promise<Organization[]> => {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .order('name', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const fetchOrganizationEmployeeLibrary = async (
  organizationId: string,
): Promise<OrganizationEmployeeLibraryItem[]> => {
  const { data, error } = await supabase
    .from('organization_employee_library')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const createOrganizationEmployeeLibraryItem = async (
  payload: OrganizationEmployeeLibraryItemInsert,
): Promise<OrganizationEmployeeLibraryItem> => {
  const { data, error } = await supabase
    .from('organization_employee_library')
    .insert(payload)
    .select('*')
    .single()

  throwOnError(error)
  if (!data) {
    throw new Error('Unable to create employee library item')
  }
  return data
}

export const updateOrganizationEmployeeLibraryItem = async (
  itemId: string,
  patch: OrganizationEmployeeLibraryItemUpdate,
) => {
  const { error } = await supabase
    .from('organization_employee_library')
    .update(patch)
    .eq('id', itemId)

  throwOnError(error)
}

export const deleteOrganizationEmployeeLibraryItem = async (itemId: string) => {
  const { error } = await supabase.from('organization_employee_library').delete().eq('id', itemId)
  throwOnError(error)
}

export const fetchOrganizationEquipmentLibrary = async (
  organizationId: string,
): Promise<OrganizationEquipmentLibraryItem[]> => {
  const { data, error } = await supabase
    .from('organization_equipment_library')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const createOrganizationEquipmentLibraryItem = async (
  payload: OrganizationEquipmentLibraryItemInsert,
): Promise<OrganizationEquipmentLibraryItem> => {
  const { data, error } = await supabase
    .from('organization_equipment_library')
    .insert(payload)
    .select('*')
    .single()

  throwOnError(error)
  if (!data) {
    throw new Error('Unable to create equipment library item')
  }
  return data
}

export const updateOrganizationEquipmentLibraryItem = async (
  itemId: string,
  patch: OrganizationEquipmentLibraryItemUpdate,
) => {
  const { error } = await supabase
    .from('organization_equipment_library')
    .update(patch)
    .eq('id', itemId)

  throwOnError(error)
}

export const deleteOrganizationEquipmentLibraryItem = async (itemId: string) => {
  const { error } = await supabase
    .from('organization_equipment_library')
    .delete()
    .eq('id', itemId)

  throwOnError(error)
}

export const fetchOrganizationMaterialLibrary = async (
  organizationId: string,
): Promise<OrganizationMaterialLibraryItem[]> => {
  const { data, error } = await supabase
    .from('organization_material_library')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const createOrganizationMaterialLibraryItem = async (
  payload: OrganizationMaterialLibraryItemInsert,
): Promise<OrganizationMaterialLibraryItem> => {
  const { data, error } = await supabase
    .from('organization_material_library')
    .insert(payload)
    .select('*')
    .single()

  throwOnError(error)
  if (!data) {
    throw new Error('Unable to create material library item')
  }
  return data
}

export const updateOrganizationMaterialLibraryItem = async (
  itemId: string,
  patch: OrganizationMaterialLibraryItemUpdate,
) => {
  const { error } = await supabase
    .from('organization_material_library')
    .update(patch)
    .eq('id', itemId)

  throwOnError(error)
}

export const deleteOrganizationMaterialLibraryItem = async (itemId: string) => {
  const { error } = await supabase.from('organization_material_library').delete().eq('id', itemId)
  throwOnError(error)
}

export const fetchPresets = async (): Promise<ContractorPreset[]> => {
  const { data, error } = await supabase
    .from('contractor_presets')
    .select('*')
    .order('name', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const fetchPresetWbsItems = async (presetId: string): Promise<PresetWbsItem[]> => {
  const { data, error } = await supabase
    .from('preset_wbs_items')
    .select('*')
    .eq('preset_id', presetId)
    .order('sort_order', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const fetchProjectSummaries = async (
  organizationId: string,
): Promise<ProjectSummary[]> => {
  const { data, error } = await supabase
    .from('project_summary')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwOnError(error)
  return data ?? []
}

export const fetchProjectSummary = async (
  projectId: string,
): Promise<ProjectSummary | null> => {
  const { data, error } = await supabase
    .from('project_summary')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()

  throwOnError(error)
  return data
}

export const fetchProjectItemMetrics = async (
  projectId: string,
): Promise<ProjectItemMetric[]> => {
  const { data, error } = await supabase
    .from('project_item_metrics')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  throwOnError(error)
  return data ?? []
}

export const fetchProjectItemMetric = async (
  itemId: string,
): Promise<ProjectItemMetric | null> => {
  const { data, error } = await supabase
    .from('project_item_metrics')
    .select('*')
    .eq('project_estimate_item_id', itemId)
    .maybeSingle()

  throwOnError(error)
  return data
}

export const createOrganization = async (name: string, slug?: string) => {
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: name,
    p_slug: slug,
  })

  throwOnError(error)
  return data
}

export const createProjectFromPreset = async (params: {
  organizationId: string
  presetId: string
  name: string
  customerName: string
  location: string
  bidDueDate: string
  notes: string
}) => {
  const { data, error } = await supabase.rpc('create_project_from_preset', {
    p_organization_id: params.organizationId,
    p_preset_id: params.presetId,
    p_name: params.name,
    p_customer_name: params.customerName || undefined,
    p_location: params.location || undefined,
    p_bid_due_date: params.bidDueDate || undefined,
    p_notes: params.notes || undefined,
  })

  throwOnError(error)
  return data
}

export const createProjectScope = async (params: {
  projectId: string
  sectionCode: string
  sectionName: string
  itemCode: string
  itemName: string
  unit: string
  presetItemId?: string | null
  isIncluded?: boolean
  quantity?: number
  laborHours?: number
  laborRate?: number
  materialCost?: number
  equipmentDays?: number
  equipmentRate?: number
  subcontractCost?: number
  overheadPercent?: number
  profitPercent?: number
}) => {
  const { data: lastRow, error: lastRowError } = await supabase
    .from('project_estimate_items')
    .select('sort_order')
    .eq('project_id', params.projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  throwOnError(lastRowError)

  const { data: createdItem, error: createItemError } = await supabase
    .from('project_estimate_items')
    .insert({
      project_id: params.projectId,
      preset_item_id: params.presetItemId ?? null,
      section_code: params.sectionCode,
      section_name: params.sectionName,
      item_code: params.itemCode,
      item_name: params.itemName,
      unit: params.unit,
      is_included: params.isIncluded ?? true,
      quantity: params.quantity ?? 0,
      labor_hours: params.laborHours ?? 0,
      labor_rate: params.laborRate ?? 0,
      material_cost: params.materialCost ?? 0,
      equipment_days: params.equipmentDays ?? 0,
      equipment_rate: params.equipmentRate ?? 0,
      subcontract_cost: params.subcontractCost ?? 0,
      overhead_percent: params.overheadPercent ?? 0,
      profit_percent: params.profitPercent ?? 0,
      sort_order: (lastRow?.sort_order ?? 0) + 10,
    })
    .select('id')
    .single()

  throwOnError(createItemError)

  if (!createdItem) {
    throw new Error('Unable to create scope')
  }

  const { error: createActualError } = await supabase.from('project_item_actuals').insert({
    project_estimate_item_id: createdItem.id,
  })

  if (createActualError) {
    await supabase.from('project_estimate_items').delete().eq('id', createdItem.id)
    throw new Error(createActualError.message)
  }

  return createdItem.id
}

export const updateProjectEstimateItem = async (
  itemId: string,
  patch: ProjectEstimateItemUpdate,
) => {
  const { error } = await supabase
    .from('project_estimate_items')
    .update(patch)
    .eq('id', itemId)

  throwOnError(error)
}

export const updateProjectStatus = async (projectId: string, status: ProjectStatus) => {
  const { error } = await supabase.from('projects').update({ status }).eq('id', projectId)
  throwOnError(error)
}

export const deleteProject = async (projectId: string) => {
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  throwOnError(error)
}

export const updateProjectActuals = async (
  projectEstimateItemId: string,
  patch: ProjectItemActualUpdate,
) => {
  const { error } = await supabase
    .from('project_item_actuals')
    .update(patch)
    .eq('project_estimate_item_id', projectEstimateItemId)

  throwOnError(error)
}
