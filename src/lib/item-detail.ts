export const defaultUnitOptions = [
  'SF',
  'SY',
  'AC',
  'LF',
  'LY',
  'IN',
  'FT',
  'CF',
  'CY',
  'EA',
  'LB',
  'TON',
]

export type CompanyEmployeeDraft = {
  name: string
  role: string
  hourlyRate: string
}

export type CompanyEquipmentDraft = {
  name: string
  dailyRate: string
}

export type CompanyMaterialDraft = {
  name: string
  unit: string
  costPerUnit: string
}

export const createEmptyCompanyEmployeeDraft = (): CompanyEmployeeDraft => ({
  name: '',
  role: '',
  hourlyRate: '0',
})

export const createEmptyCompanyEquipmentDraft = (): CompanyEquipmentDraft => ({
  name: '',
  dailyRate: '0',
})

export const createEmptyCompanyMaterialDraft = (): CompanyMaterialDraft => ({
  name: '',
  unit: 'SF',
  costPerUnit: '0',
})

export const parseNumericInput = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const roundCurrencyValue = (value: number) => Math.round(value * 100) / 100

export const calculateExtendedCost = (quantity: number, unitCost: number) =>
  roundCurrencyValue(quantity * unitCost)

export const deriveUnitCost = (totalCost: number, quantity: number) =>
  quantity > 0 ? roundCurrencyValue(totalCost / quantity) : 0

export const calculateActualOverheadCost = (
  actualDirectCost: number,
  overheadPercent: number | null | undefined,
) => roundCurrencyValue(actualDirectCost * ((overheadPercent ?? 0) / 100))

export const buildUnitOptions = (currentUnit?: string | null, customUnits: string[] = []) =>
  Array.from(
    new Set(
      [...defaultUnitOptions, currentUnit?.toUpperCase() ?? '', ...customUnits.map((unit) => unit.toUpperCase())]
        .map((unit) => unit.trim())
        .filter(Boolean),
    ),
  )
