import { jsPDF } from 'jspdf'

import { formatCurrency, formatDate, formatNumber } from './formatters'
import type { ProjectItemMetric, ProjectSummary } from './models'
import { compareScopeHierarchy } from './scope-hierarchy'

type RgbColor = [number, number, number]

type ProposalPdfOptions = {
  organizationName: string
  project: ProjectSummary
  items: ProjectItemMetric[]
}

type ProposalSection = {
  title: string
  rows: ProjectItemMetric[]
  total: number
}

type ProposalTableColumn = {
  header: string
  width: number
  align: 'left' | 'right'
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const PAGE_MARGIN = 40
const HEADER_BASE_HEIGHT = 126
const HEADER_CALLOUT_WIDTH = 146
const HEADER_CALLOUT_HEIGHT = 92
const HEADER_CALLOUT_GAP = 24
const DETAIL_STRIP_HEIGHT = 48
const TABLE_TOP_GAP = 10
const TABLE_HEADER_HEIGHT = 32
const SECTION_ROW_HEIGHT = 26
const SUBTOTAL_ROW_HEIGHT = 24
const ITEM_FONT_SIZE = 9.5
const ITEM_MIN_ROW_HEIGHT = 24
const ITEM_LINE_HEIGHT = 11
const ITEM_CELL_PADDING_X = 12
const ITEM_CELL_PADDING_Y = 6
const FOOTER_LINE_Y = 770
const FOOTER_TEXT_Y = 784
const TABLE_END_Y = PAGE_HEIGHT - 60
const ACCEPTANCE_TOP_GAP = 16
const ACCEPTANCE_LINE_Y_OFFSET = 16
const ACCEPTANCE_BLOCK_HEIGHT = 36
const TABLE_COLUMNS: ProposalTableColumn[] = [
  { header: 'Scope item', width: 302, align: 'left' },
  { header: 'Qty', width: 72, align: 'right' },
  { header: 'Unit', width: 68, align: 'left' },
  { header: 'Amount', width: 90, align: 'right' },
]
const TABLE_WIDTH = TABLE_COLUMNS.reduce((sum, column) => sum + column.width, 0)
const SUBTOTAL_SPLIT_X = PAGE_MARGIN + TABLE_COLUMNS[0].width + TABLE_COLUMNS[1].width + TABLE_COLUMNS[2].width
const COLORS = {
  ink: [22, 35, 22] as RgbColor,
  brand: [47, 125, 50] as RgbColor,
  brandSoft: [230, 244, 231] as RgbColor,
  surface: [255, 255, 255] as RgbColor,
  surfaceAlt: [241, 247, 239] as RgbColor,
  panel: [237, 243, 234] as RgbColor,
  border: [201, 214, 201] as RgbColor,
  text: [22, 35, 22] as RgbColor,
  muted: [95, 111, 96] as RgbColor,
  subtle: [207, 218, 208] as RgbColor,
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const getTextValue = (
  value: string | null | undefined,
  fallback = '—',
) => value?.trim() || fallback

const getProposalPdfFileName = (projectName: string) =>
  `${slugify(projectName || 'proposal')}-proposal.pdf`

const getSectionTitle = (item: ProjectItemMetric) => {
  const sectionCode = item.section_code?.trim()
  const sectionName = item.section_name?.trim() || 'Scope'

  if (sectionCode) {
    return `${sectionCode} · ${sectionName}`
  }

  return sectionName
}

const fitText = (doc: jsPDF, value: string, maxWidth: number) => {
  if (doc.getTextWidth(value) <= maxWidth) {
    return value
  }

  let trimmed = value.trim()

  while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd()
  }

  return trimmed ? `${trimmed}…` : '—'
}

const drawLogo = (doc: jsPDF, x: number, y: number) => {
  doc.setFillColor(...COLORS.brand)
  doc.roundedRect(x, y, 24, 24, 7, 7, 'F')
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(1.5)
  doc.line(x + 5, y + 13, x + 12, y + 6)
  doc.line(x + 12, y + 6, x + 19, y + 13)
  doc.line(x + 8, y + 13, x + 8, y + 18)
  doc.line(x + 16, y + 13, x + 16, y + 18)
  doc.line(x + 6.5, y + 18, x + 17.5, y + 18)
  doc.setFillColor(255, 255, 255)
  doc.circle(x + 18.5, y + 7.5, 1.6, 'F')
}

const drawPanel = ({
  doc,
  x,
  y,
  width,
  height,
  fillColor = COLORS.surface,
  borderColor = COLORS.border,
}: {
  doc: jsPDF
  x: number
  y: number
  width: number
  height: number
  fillColor?: RgbColor
  borderColor?: RgbColor
}) => {
  doc.setFillColor(...fillColor)
  doc.setDrawColor(...borderColor)
  doc.setLineWidth(1)
  doc.roundedRect(x, y, width, height, 16, 16, 'FD')
}

const drawDetailStrip = ({
  doc,
  y,
  details,
}: {
  doc: jsPDF
  y: number
  details: Array<{ label: string; value: string }>
}) => {
  const stripX = PAGE_MARGIN
  const stripWidth = PAGE_WIDTH - PAGE_MARGIN * 2
  const stripHeight = DETAIL_STRIP_HEIGHT
  const columnWidth = stripWidth / details.length

  drawPanel({
    doc,
    x: stripX,
    y,
    width: stripWidth,
    height: stripHeight,
  })

  details.forEach((detail, index) => {
    const columnX = stripX + columnWidth * index

    if (index > 0) {
      doc.setDrawColor(...COLORS.border)
      doc.setLineWidth(1)
      doc.line(columnX, y + 12, columnX, y + stripHeight - 12)
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.muted)
    doc.text(detail.label.toUpperCase(), columnX + 14, y + 19)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...COLORS.text)
    doc.text(fitText(doc, detail.value, columnWidth - 28), columnX + 14, y + 39)
  })

  return y + stripHeight
}

const drawHeaderCallout = ({
  doc,
  x,
  y,
  width,
  preparedDate,
  estimatedTotal,
}: {
  doc: jsPDF
  x: number
  y: number
  width: number
  preparedDate: string
  estimatedTotal: number
}) => {
  drawPanel({
    doc,
    x,
    y,
    width,
    height: HEADER_CALLOUT_HEIGHT,
    fillColor: [28, 46, 29],
    borderColor: COLORS.brand,
  })

  doc.setFillColor(...COLORS.brand)
  doc.roundedRect(x + 18, y + 14, 46, 3, 1.5, 1.5, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.subtle)
  doc.text('PREPARED', x + 18, y + 28)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text(preparedDate, x + 18, y + 46)

  doc.setDrawColor(84, 109, 85)
  doc.setLineWidth(1)
  doc.line(x + 18, y + 58, x + width - 18, y + 58)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.subtle)
  doc.text('EST. TOTAL', x + 18, y + 70)

  const amountText = formatCurrency(estimatedTotal)
  let amountFontSize = 22

  while (amountFontSize > 16) {
    doc.setFontSize(amountFontSize)

    if (doc.getTextWidth(amountText) <= width - 36) {
      break
    }

    amountFontSize -= 1
  }

  doc.setTextColor(255, 255, 255)
  doc.text(amountText, x + 18, y + HEADER_CALLOUT_HEIGHT - 6)
}

const drawAcceptanceStrip = ({
  doc,
  y,
}: {
  doc: jsPDF
  y: number
}) => {
  const dateLineX = PAGE_WIDTH - PAGE_MARGIN - 94
  const lineY = y + ACCEPTANCE_LINE_Y_OFFSET

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.text)
  doc.text('Client acceptance', PAGE_MARGIN, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...COLORS.muted)
  doc.text('Sign and date to approve this proposal.', PAGE_WIDTH - PAGE_MARGIN, y, {
    align: 'right',
  })

  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(1)
  doc.line(PAGE_MARGIN, lineY, dateLineX - 14, lineY)
  doc.line(dateLineX, lineY, PAGE_WIDTH - PAGE_MARGIN, lineY)

  doc.setFontSize(8)
  doc.text('Signature', PAGE_MARGIN, lineY + 14)
  doc.text('Date', dateLineX, lineY + 14)
}

const addFooters = ({
  doc,
  brandName,
}: {
  doc: jsPDF
  brandName: string
}) => {
  const pageCount = doc.getNumberOfPages()

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber)
    doc.setDrawColor(...COLORS.border)
    doc.setLineWidth(1)
    doc.line(PAGE_MARGIN, FOOTER_LINE_Y, PAGE_WIDTH - PAGE_MARGIN, FOOTER_LINE_Y)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...COLORS.muted)
    doc.text('Prepared from the live estimate worksheet.', PAGE_MARGIN, FOOTER_TEXT_Y)
    doc.text(
      fitText(doc, `${brandName} • Page ${pageNumber} of ${pageCount}`, 190),
      PAGE_WIDTH - PAGE_MARGIN,
      FOOTER_TEXT_Y,
      { align: 'right' },
    )
  }
}

const getItemLabelLines = (doc: jsPDF, value: string) => {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(ITEM_FONT_SIZE)
  return doc.splitTextToSize(value, TABLE_COLUMNS[0].width - ITEM_CELL_PADDING_X * 2)
}

const getItemRowHeight = (doc: jsPDF, value: string) => {
  const lines = getItemLabelLines(doc, value)
  return Math.max(ITEM_MIN_ROW_HEIGHT, ITEM_CELL_PADDING_Y * 2 + lines.length * ITEM_LINE_HEIGHT)
}

const drawTableHeader = (doc: jsPDF, y: number) => {
  doc.setFillColor(...COLORS.ink)
  doc.setDrawColor(...COLORS.ink)
  doc.setLineWidth(0.8)
  doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, TABLE_HEADER_HEIGHT, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)

  let cursorX = PAGE_MARGIN

  TABLE_COLUMNS.forEach((column) => {
    const textX = column.align === 'right' ? cursorX + column.width - 12 : cursorX + 12

    doc.text(column.header, textX, y + 21, {
      align: column.align === 'right' ? 'right' : 'left',
    })

    cursorX += column.width
  })
}

const drawSectionRow = (doc: jsPDF, y: number, title: string) => {
  doc.setFillColor(...COLORS.brandSoft)
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.45)
  doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, SECTION_ROW_HEIGHT, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...COLORS.text)
  doc.text(title, PAGE_MARGIN + 12, y + 17)
}

const drawItemRow = ({
  doc,
  y,
  item,
  rowHeight,
  fillColor,
}: {
  doc: jsPDF
  y: number
  item: ProjectItemMetric
  rowHeight: number
  fillColor: RgbColor
}) => {
  const labelText = getTextValue(item.item_name, 'Scope item')
  const labelLines = getItemLabelLines(doc, labelText)
  const quantityText = formatNumber(item.quantity)
  const unitText = getTextValue(item.unit, '')
  const amountText = formatCurrency(item.estimated_total_cost)

  let cursorX = PAGE_MARGIN

  TABLE_COLUMNS.forEach((column) => {
    doc.setFillColor(...fillColor)
    doc.setDrawColor(...COLORS.border)
    doc.setLineWidth(0.45)
    doc.rect(cursorX, y, column.width, rowHeight, 'FD')
    cursorX += column.width
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(ITEM_FONT_SIZE)
  doc.setTextColor(...COLORS.text)
  doc.text(labelLines, PAGE_MARGIN + ITEM_CELL_PADDING_X, y + ITEM_CELL_PADDING_Y + 7)

  const centeredTextY = y + rowHeight / 2 + 3
  const quantityX = PAGE_MARGIN + TABLE_COLUMNS[0].width + TABLE_COLUMNS[1].width - 12
  const unitX = PAGE_MARGIN + TABLE_COLUMNS[0].width + TABLE_COLUMNS[1].width + 12
  const amountX = PAGE_MARGIN + TABLE_WIDTH - 12

  doc.text(quantityText, quantityX, centeredTextY, { align: 'right' })
  doc.text(unitText, unitX, centeredTextY)
  doc.text(amountText, amountX, centeredTextY, { align: 'right' })
}

const drawSubtotalRow = (doc: jsPDF, y: number, total: number) => {
  doc.setFillColor(...COLORS.panel)
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.45)
  doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, SUBTOTAL_ROW_HEIGHT, 'FD')

  doc.setDrawColor(...COLORS.brand)
  doc.setLineWidth(0.8)
  doc.line(PAGE_MARGIN, y, PAGE_MARGIN + TABLE_WIDTH, y)

  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.45)
  doc.line(SUBTOTAL_SPLIT_X, y, SUBTOTAL_SPLIT_X, y + SUBTOTAL_ROW_HEIGHT)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...COLORS.muted)
  doc.text('Section subtotal', SUBTOTAL_SPLIT_X - 12, y + 17, { align: 'right' })

  doc.setTextColor(...COLORS.text)
  doc.text(formatCurrency(total), PAGE_MARGIN + TABLE_WIDTH - 12, y + 17, {
    align: 'right',
  })
}

export const createProposalPdf = ({
  organizationName,
  project,
  items,
}: ProposalPdfOptions) => {
  const doc = new jsPDF({
    format: 'letter',
    unit: 'pt',
  })

  const includedItems = items
    .filter((item) => item.is_included)
    .sort(compareScopeHierarchy)

  const projectName = getTextValue(project.name, 'Proposal')
  const brandName = getTextValue(organizationName, 'ProfitBuilder')
  const customerName = getTextValue(project.customer_name, 'Client')
  const locationName = getTextValue(project.location, 'Location pending')
  const bidDue = project.bid_due_date ? formatDate(project.bid_due_date) : 'TBD'
  const preparedDate = formatDate(new Date().toISOString())
  const estimatedTotal = includedItems.reduce(
    (sum, item) => sum + (item.estimated_total_cost ?? 0),
    0,
  )
  const groupedSections = Array.from(
    includedItems.reduce(
      (groups, item) => {
        const title = getSectionTitle(item)

        if (!groups.has(title)) {
          groups.set(title, [])
        }

        groups.get(title)?.push(item)
        return groups
      },
      new Map<string, ProjectItemMetric[]>(),
    ),
  ).map(
    ([title, sectionItems]): ProposalSection => ({
      title,
      rows: sectionItems,
      total: sectionItems.reduce((sum, item) => sum + (item.estimated_total_cost ?? 0), 0),
    }),
  )

  const headerCalloutX = PAGE_WIDTH - PAGE_MARGIN - HEADER_CALLOUT_WIDTH
  const headerTextWidth = headerCalloutX - PAGE_MARGIN - HEADER_CALLOUT_GAP
  const brandTextWidth = headerCalloutX - 74 - HEADER_CALLOUT_GAP

  let titleFontSize = 30
  let titleLines = [projectName]
  doc.setFont('helvetica', 'bold')

  while (titleFontSize > 22) {
    doc.setFontSize(titleFontSize)
    titleLines = doc.splitTextToSize(projectName, headerTextWidth)

    if (titleLines.length <= 2) {
      break
    }

    titleFontSize -= 2
  }

  const headerHeight = HEADER_BASE_HEIGHT + (titleLines.length - 1) * 24

  doc.setFillColor(...COLORS.ink)
  doc.rect(0, 0, PAGE_WIDTH, headerHeight, 'F')
  doc.setFillColor(...COLORS.brand)
  doc.rect(0, headerHeight - 5, PAGE_WIDTH, 5, 'F')

  drawLogo(doc, PAGE_MARGIN, 28)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(21)
  doc.setTextColor(255, 255, 255)
  doc.text(fitText(doc, brandName, brandTextWidth), 74, 48)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.subtle)
  doc.text('Client proposal', 74, 64)

  drawHeaderCallout({
    doc,
    x: headerCalloutX,
    y: 22,
    width: HEADER_CALLOUT_WIDTH,
    preparedDate,
    estimatedTotal,
  })

  doc.setFontSize(titleFontSize)
  doc.setTextColor(255, 255, 255)
  doc.text(titleLines, PAGE_MARGIN, 92)

  const titleBottom = 92 + (titleLines.length - 1) * titleFontSize * 1.15

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...COLORS.subtle)
  doc.text(
    fitText(
      doc,
      'Clear scope, pricing, and client approval summary.',
      headerTextWidth,
    ),
    PAGE_MARGIN,
    titleBottom + 16,
  )

  const detailsBottom = drawDetailStrip({
    doc,
    y: headerHeight + 14,
    details: [
      { label: 'Customer', value: customerName },
      { label: 'Property', value: locationName },
      { label: 'Bid due', value: bidDue },
    ],
  })

  let tableY = detailsBottom + TABLE_TOP_GAP

  const startNewTablePage = () => {
    doc.addPage()
    tableY = PAGE_MARGIN
    drawTableHeader(doc, tableY)
    tableY += TABLE_HEADER_HEIGHT
  }

  const ensureTableSpace = (spaceNeeded: number) => {
    if (tableY + spaceNeeded <= TABLE_END_Y) {
      return
    }

    startNewTablePage()
  }

  drawTableHeader(doc, tableY)
  tableY += TABLE_HEADER_HEIGHT

  if (groupedSections.length === 0) {
    const rowHeight = ITEM_MIN_ROW_HEIGHT

    doc.setFillColor(...COLORS.surface)
    doc.setDrawColor(...COLORS.border)
    doc.setLineWidth(0.45)
    doc.rect(PAGE_MARGIN, tableY, TABLE_WIDTH, rowHeight, 'FD')

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(ITEM_FONT_SIZE)
    doc.setTextColor(...COLORS.muted)
    doc.text('No included scope items yet.', PAGE_MARGIN + ITEM_CELL_PADDING_X, tableY + 16)

    tableY += rowHeight
  } else {
    groupedSections.forEach((section) => {
      const firstRowHeight = getItemRowHeight(
        doc,
        getTextValue(section.rows[0]?.item_name, 'Scope item'),
      )
      const compactSectionHeight = section.rows.reduce(
        (sum, row) => sum + getItemRowHeight(doc, getTextValue(row.item_name, 'Scope item')),
        SECTION_ROW_HEIGHT + SUBTOTAL_ROW_HEIGHT,
      )
      const sectionReservation = section.rows.length <= 3
        ? compactSectionHeight
        : SECTION_ROW_HEIGHT + firstRowHeight

      ensureTableSpace(sectionReservation)
      drawSectionRow(doc, tableY, section.title)
      tableY += SECTION_ROW_HEIGHT

      section.rows.forEach((item, index) => {
        const labelText = getTextValue(item.item_name, 'Scope item')
        const rowHeight = getItemRowHeight(doc, labelText)
        const remainingRows = section.rows.slice(index)
        const trailingReservation = remainingRows.length <= 2
          ? remainingRows.reduce(
            (sum, row) => sum + getItemRowHeight(doc, getTextValue(row.item_name, 'Scope item')),
            SUBTOTAL_ROW_HEIGHT,
          )
          : rowHeight

        ensureTableSpace(trailingReservation)
        drawItemRow({
          doc,
          y: tableY,
          item,
          rowHeight,
          fillColor: index % 2 === 0 ? COLORS.surface : COLORS.surfaceAlt,
        })
        tableY += rowHeight
      })

      ensureTableSpace(SUBTOTAL_ROW_HEIGHT)
      drawSubtotalRow(doc, tableY, section.total)
      tableY += SUBTOTAL_ROW_HEIGHT
    })
  }

  let acceptanceY = tableY + ACCEPTANCE_TOP_GAP

  if (acceptanceY + ACCEPTANCE_BLOCK_HEIGHT > FOOTER_LINE_Y - 6) {
    doc.addPage()
    acceptanceY = 72
  }

  drawAcceptanceStrip({ doc, y: acceptanceY })

  addFooters({ doc, brandName })

  return doc
}

export const exportProposalPdf = (options: ProposalPdfOptions) => {
  const doc = createProposalPdf(options)
  doc.save(getProposalPdfFileName(getTextValue(options.project.name, 'proposal')))
  return doc
}
