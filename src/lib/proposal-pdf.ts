import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { formatCurrency, formatDate, formatNumber } from './formatters'
import type { ProjectItemMetric, ProjectSummary } from './models'

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

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const PAGE_MARGIN = 40
const HEADER_BASE_HEIGHT = 126
const HEADER_CALLOUT_WIDTH = 146
const HEADER_CALLOUT_GAP = 24
const DETAIL_STRIP_HEIGHT = 48
const FOOTER_LINE_Y = 770
const FOOTER_TEXT_Y = 784
const ACCEPTANCE_TOP_GAP = 12
const ACCEPTANCE_LINE_Y_OFFSET = 15
const TABLE_BOTTOM_MARGIN = PAGE_HEIGHT - FOOTER_LINE_Y + 38
const COLORS = {
  ink: [15, 23, 42] as RgbColor,
  brand: [37, 99, 235] as RgbColor,
  brandSoft: [239, 246, 255] as RgbColor,
  surface: [255, 255, 255] as RgbColor,
  surfaceAlt: [248, 250, 252] as RgbColor,
  panel: [241, 245, 249] as RgbColor,
  border: [226, 232, 240] as RgbColor,
  text: [15, 23, 42] as RgbColor,
  muted: [100, 116, 139] as RgbColor,
  subtle: [203, 213, 225] as RgbColor,
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
    height: 86,
    fillColor: [30, 41, 59],
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
  doc.text(preparedDate, x + 18, y + 44)

  doc.setDrawColor(71, 85, 105)
  doc.setLineWidth(1)
  doc.line(x + 18, y + 54, x + width - 18, y + 54)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.subtle)
  doc.text('EST. TOTAL', x + 18, y + 69)

  doc.setFontSize(19)
  doc.setTextColor(255, 255, 255)
  doc.text(formatCurrency(estimatedTotal), x + 18, y + 85)
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
  doc.text('Signature', PAGE_MARGIN, lineY + 12)
  doc.text('Date', dateLineX, lineY + 12)
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
    .sort((left, right) => {
      const sortOrderDifference = (left.sort_order ?? Number.MAX_SAFE_INTEGER) - (right.sort_order ?? Number.MAX_SAFE_INTEGER)

      if (sortOrderDifference !== 0) {
        return sortOrderDifference
      }

      return `${left.section_code ?? ''}${left.item_code ?? ''}${left.item_name ?? ''}`.localeCompare(
        `${right.section_code ?? ''}${right.item_code ?? ''}${right.item_name ?? ''}`,
      )
    })

  const projectName = getTextValue(project.name, 'Proposal')
  const brandName = getTextValue(organizationName, 'Estimator Workspace')
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

  autoTable(doc, {
    startY: detailsBottom + 12,
    theme: 'grid',
    margin: {
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      bottom: TABLE_BOTTOM_MARGIN,
    },
    styles: {
      font: 'helvetica',
      fontSize: 10,
      textColor: COLORS.text,
      lineColor: COLORS.border,
      lineWidth: 0.45,
      cellPadding: 5.5,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: COLORS.ink,
      textColor: [255, 255, 255],
      fontSize: 10,
      fontStyle: 'bold',
      lineColor: COLORS.ink,
      lineWidth: 0.8,
      cellPadding: 6.5,
    },
    bodyStyles: {
      textColor: COLORS.text,
    },
    alternateRowStyles: {
      fillColor: COLORS.surfaceAlt,
    },
    columnStyles: {
      0: { cellWidth: 302 },
      1: { cellWidth: 72, halign: 'right' },
      2: { cellWidth: 68, halign: 'left' },
      3: { cellWidth: 90, halign: 'right' },
    },
    head: [['Scope item', 'Qty', 'Unit', 'Amount']],
    body: groupedSections.flatMap((section) => [
      [
        {
          content: section.title,
          colSpan: 4,
          styles: {
            fillColor: COLORS.brandSoft,
            textColor: COLORS.text,
            fontStyle: 'bold',
            fontSize: 10,
            cellPadding: 6,
          },
        },
      ],
      ...section.rows.map((item) => [
        item.item_name ?? 'Scope item',
        formatNumber(item.quantity),
        item.unit ?? '',
        formatCurrency(item.estimated_total_cost),
      ]),
      [
        {
          content: 'Section subtotal',
          colSpan: 3,
          styles: {
            halign: 'right',
            fontStyle: 'bold',
            fillColor: COLORS.surface,
            textColor: COLORS.muted,
            cellPadding: 5.5,
          },
        },
        {
          content: formatCurrency(section.total),
          styles: {
            halign: 'right',
            fontStyle: 'bold',
            fillColor: COLORS.surface,
            textColor: COLORS.text,
            cellPadding: 5.5,
          },
        },
      ],
    ]),
  })

  const tableBottom = (doc as jsPDF & {
    lastAutoTable?: {
      finalY?: number
    }
  }).lastAutoTable?.finalY

  let acceptanceY = (tableBottom ?? detailsBottom + 12) + ACCEPTANCE_TOP_GAP

  if (acceptanceY + ACCEPTANCE_LINE_Y_OFFSET + 12 > FOOTER_LINE_Y - 6) {
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
