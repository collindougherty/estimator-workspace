import { useCallback, useEffect, useState } from 'react'

import {
  createOrganizationEmployeeLibraryItem,
  createOrganizationEquipmentLibraryItem,
  createOrganizationMaterialLibraryItem,
  deleteOrganizationEmployeeLibraryItem,
  deleteOrganizationEquipmentLibraryItem,
  deleteOrganizationMaterialLibraryItem,
  fetchOrganizationEmployeeLibrary,
  fetchOrganizationEquipmentLibrary,
  fetchOrganizationMaterialLibrary,
} from '../lib/api'
import type {
  OrganizationEmployeeLibraryItem,
  OrganizationEquipmentLibraryItem,
  OrganizationMaterialLibraryItem,
} from '../lib/models'

type UseCompanyLibraryOptions = {
  onError?: (message: string | null) => void
  organizationId?: string | null
}

export const useCompanyLibrary = ({
  onError,
  organizationId,
}: UseCompanyLibraryOptions) => {
  const [employees, setEmployees] = useState<OrganizationEmployeeLibraryItem[]>([])
  const [equipment, setEquipment] = useState<OrganizationEquipmentLibraryItem[]>([])
  const [materials, setMaterials] = useState<OrganizationMaterialLibraryItem[]>([])
  const [isBusy, setIsBusy] = useState(false)

  const loadCompanyLibraries = useCallback(async () => {
    if (!organizationId) {
      setEmployees([])
      setEquipment([])
      setMaterials([])
      return
    }

    onError?.(null)

    try {
      const [nextEmployees, nextEquipment, nextMaterials] = await Promise.all([
        fetchOrganizationEmployeeLibrary(organizationId),
        fetchOrganizationEquipmentLibrary(organizationId),
        fetchOrganizationMaterialLibrary(organizationId),
      ])

      setEmployees(nextEmployees)
      setEquipment(nextEquipment)
      setMaterials(nextMaterials)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Unable to load company library'
      onError?.(message)
    }
  }, [onError, organizationId])

  useEffect(() => {
    void loadCompanyLibraries()
  }, [loadCompanyLibraries])

  const runMutation = useCallback(
    async <T,>(mutation: (currentOrganizationId: string) => Promise<T>) => {
      if (!organizationId) {
        throw new Error('Organization is unavailable')
      }

      setIsBusy(true)
      onError?.(null)

      try {
        const result = await mutation(organizationId)
        await loadCompanyLibraries()
        return result
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : 'Unable to update company library'
        onError?.(message)
        throw caughtError
      } finally {
        setIsBusy(false)
      }
    },
    [loadCompanyLibraries, onError, organizationId],
  )

  const createEmployee = useCallback(
    async (draft: { hourlyRate: number; name: string; role: string }) => {
      return runMutation(async (currentOrganizationId) => {
        return createOrganizationEmployeeLibraryItem({
          organization_id: currentOrganizationId,
          name: draft.name,
          role: draft.role || null,
          hourly_rate: draft.hourlyRate,
        })
      })
    },
    [runMutation],
  )

  const deleteEmployee = useCallback(
    async (itemId: string) => {
      await runMutation(async () => {
        await deleteOrganizationEmployeeLibraryItem(itemId)
      })
    },
    [runMutation],
  )

  const createEquipment = useCallback(
    async (draft: { dailyRate: number; name: string }) => {
      return runMutation(async (currentOrganizationId) => {
        return createOrganizationEquipmentLibraryItem({
          organization_id: currentOrganizationId,
          name: draft.name,
          daily_rate: draft.dailyRate,
        })
      })
    },
    [runMutation],
  )

  const deleteEquipment = useCallback(
    async (itemId: string) => {
      await runMutation(async () => {
        await deleteOrganizationEquipmentLibraryItem(itemId)
      })
    },
    [runMutation],
  )

  const createMaterial = useCallback(
    async (draft: { costPerUnit: number; name: string; unit: string }) => {
      return runMutation(async (currentOrganizationId) => {
        return createOrganizationMaterialLibraryItem({
          organization_id: currentOrganizationId,
          name: draft.name,
          unit: draft.unit,
          cost_per_unit: draft.costPerUnit,
        })
      })
    },
    [runMutation],
  )

  const deleteMaterial = useCallback(
    async (itemId: string) => {
      await runMutation(async () => {
        await deleteOrganizationMaterialLibraryItem(itemId)
      })
    },
    [runMutation],
  )

  return {
    createEmployee,
    createEquipment,
    createMaterial,
    deleteEmployee,
    deleteEquipment,
    deleteMaterial,
    employees,
    equipment,
    isBusy,
    loadCompanyLibraries,
    materials,
  }
}
