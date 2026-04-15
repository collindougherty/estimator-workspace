type ScopeLike = {
  item_code?: string | null
  item_name?: string | null
  section_code?: string | null
  sort_order?: number | null
}

const compareScopeCode = (left?: string | null, right?: string | null) =>
  (left ?? '').localeCompare(right ?? '', undefined, {
    numeric: true,
    sensitivity: 'base',
  })

const readTrailingNumber = (value?: string | null) => {
  const match = value?.trim().match(/(\d+)(?!.*\d)/)

  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export const compareScopeHierarchy = <T extends ScopeLike>(left: T, right: T) => {
  const sectionCompare = compareScopeCode(left.section_code, right.section_code)

  if (sectionCompare !== 0) {
    return sectionCompare
  }

  const itemCompare = compareScopeCode(left.item_code, right.item_code)

  if (itemCompare !== 0) {
    return itemCompare
  }

  const sortDifference =
    (left.sort_order ?? Number.MAX_SAFE_INTEGER) - (right.sort_order ?? Number.MAX_SAFE_INTEGER)

  if (sortDifference !== 0) {
    return sortDifference
  }

  return (left.item_name ?? '').localeCompare(right.item_name ?? '', undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export const sortScopeItems = <T extends ScopeLike>(items: T[]) => [...items].sort(compareScopeHierarchy)

export const getNextSectionCode = (items: ScopeLike[]) => {
  const sectionCodes = Array.from(
    new Set(
      items
        .map((item) => item.section_code?.trim())
        .filter((sectionCode): sectionCode is string => Boolean(sectionCode)),
    ),
  )

  const maxSectionNumber = sectionCodes.reduce((maxValue, sectionCode) => {
    const sectionNumber = readTrailingNumber(sectionCode)
    return sectionNumber && sectionNumber > maxValue ? sectionNumber : maxValue
  }, 0)

  const width = Math.max(
    2,
    ...sectionCodes
      .map((sectionCode) => readTrailingNumber(sectionCode))
      .filter((sectionNumber): sectionNumber is number => sectionNumber !== null)
      .map((sectionNumber) => String(sectionNumber).length),
  )

  return String(maxSectionNumber + 1).padStart(width, '0')
}

export const getNextItemCode = (items: ScopeLike[], sectionCode: string) => {
  const normalizedSectionCode = sectionCode.trim()
  const suffixes = items
    .filter((item) => item.section_code?.trim() === normalizedSectionCode)
    .map((item) => readTrailingNumber(item.item_code))
    .filter((suffix): suffix is number => suffix !== null)

  const maxSuffix = suffixes.length > 0 ? Math.max(...suffixes) : 0
  const nextSuffix = maxSuffix === 0 ? 10 : Math.ceil((maxSuffix + 1) / 10) * 10

  return `${normalizedSectionCode}.${String(nextSuffix).padStart(2, '0')}`
}
