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

export type MaterialLibraryOption = {
  label: string
  unit: string
  costPerUnit: number
}

export type EquipmentLibraryOption = {
  label: string
  rate: number
}

export const materialLibraryOptions: MaterialLibraryOption[] = [
  { label: 'Architectural shingles', unit: 'SF', costPerUnit: 5.01 },
  { label: 'Ice and water shield', unit: 'SF', costPerUnit: 3.06 },
  { label: 'Synthetic underlayment', unit: 'SF', costPerUnit: 0.57 },
  { label: 'Flashing and drip edge', unit: 'LF', costPerUnit: 8 },
  { label: 'Gutters and downspouts', unit: 'LF', costPerUnit: 17.79 },
  { label: 'Siding patch and replacement', unit: 'SF', costPerUnit: 29.2 },
]

export const equipmentLibraryOptions: EquipmentLibraryOption[] = [
  { label: 'Dump trailer', rate: 160 },
  { label: 'Boom lift', rate: 325 },
  { label: 'Skid steer', rate: 280 },
  { label: 'Telehandler', rate: 360 },
  { label: 'Mini excavator', rate: 295 },
]

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
