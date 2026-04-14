import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { formatCurrency, formatDate, formatNumber } from './formatters'
import type { ProjectItemMetric, ProjectSummary } from './models'

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const drawLogo = (doc: jsPDF, x: number, y: number) => {
  doc.setFillColor(15, 23, 42)
  doc.roundedRect(x, y, 18, 18, 4, 4, 'F')
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(1.2)
  doc.line(x + 4, y + 11, x + 9, y + 6)
  doc.line(x + 9, y + 6, x + 14, y + 11)
  doc.line(x + 6, y + 11, x + 6, y + 14)
  doc.line(x + 12, y + 11, x + 12, y + 14)
  doc.line(x + 5.5, y + 14, x + 12.5, y + 14)
}

const drawInfoCard = ({
  doc,
  x,
  y,
  width,
  label,
  value,
}: {
  doc: jsPDF
  x: number
  y: number
  width: number
  label: string
  value: string
}) => {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(219, 228, 238)
  doc.roundedRect(x, y, width, 48, 10, 10, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(label, x + 14, y + 16)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text(value, x + 14, y + 32)
}

export const exportProposalPdf = ({
  organizationName,
  project,
  items,
}: {
  organizationName: string
  project: ProjectSummary
  items: ProjectItemMetric[]
}) => {
  const doc = new jsPDF({
    format: 'letter',
    unit: 'pt',
  })

  const includedItems = items.filter((item) => item.is_included)
  const projectName = project.name ?? 'Proposal'
  const brandName = organizationName || 'Estimator Workspace'
  const estimatedTotal = includedItems.reduce(
    (sum, item) => sum + (item.estimated_total_cost ?? 0),
    0,
  )
  const groupedSections = Array.from(
    includedItems.reduce(
      (groups, item) => {
        const title = `${item.section_code ?? ''} · ${item.section_name ?? 'Scope'}`.trim()

        if (!groups.has(title)) {
          groups.set(title, [])
        }

        groups.get(title)?.push(item)
        return groups
      },
      new Map<string, ProjectItemMetric[]>(),
    ),
  ).map(([title, sectionItems]) => ({
    title,
    rows: sectionItems,
    total: sectionItems.reduce((sum, item) => sum + (item.estimated_total_cost ?? 0), 0),
  }))

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, 612, 128, 'F')

  drawLogo(doc, 40, 32)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text(brandName, 68, 50)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(203, 213, 225)
  doc.text('Project proposal', 68, 66)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(255, 255, 255)
  doc.text(projectName, 40, 104)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Prepared ${formatDate(new Date().toISOString())}`, 572, 44, { align: 'right' })

  drawInfoCard({
    doc,
    x: 40,
    y: 144,
    width: 160,
    label: 'Customer',
    value: project.customer_name ?? '—',
  })
  drawInfoCard({
    doc,
    x: 212,
    y: 144,
    width: 170,
    label: 'Location',
    value: project.location ?? '—',
  })
  drawInfoCard({
    doc,
    x: 394,
    y: 144,
    width: 178,
    label: 'Bid due',
    value: formatDate(project.bid_due_date),
  })

  autoTable(doc, {
    startY: 220,
    theme: 'grid',
    margin: { left: 40, right: 40 },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontSize: 10,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 10,
      textColor: [15, 23, 42],
      lineColor: [219, 228, 238],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 270 },
      1: { halign: 'right', cellWidth: 70 },
      2: { halign: 'left', cellWidth: 60 },
      3: { halign: 'right', cellWidth: 90 },
    },
    head: [['Scope', 'Qty', 'Unit', 'Price']],
    body: groupedSections.flatMap((section) => [
      [
        {
          content: section.title,
          colSpan: 4,
          styles: {
            fillColor: [241, 245, 249],
            textColor: [15, 23, 42],
            fontStyle: 'bold',
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
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
          },
        },
        {
          content: formatCurrency(section.total),
          styles: {
            halign: 'right',
            fontStyle: 'bold',
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
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
  const totalY = (tableBottom ?? 184) + 26

  drawInfoCard({
    doc,
    x: 392,
    y: totalY + 10,
    width: 180,
    label: 'Estimated total',
    value: formatCurrency(estimatedTotal),
  })

  doc.setDrawColor(219, 228, 238)
  doc.line(40, totalY + 90, 280, totalY + 90)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('Accepted by', 40, totalY + 105)

  doc.line(320, totalY + 90, 520, totalY + 90)
  doc.text('Date', 320, totalY + 105)

  doc.text('Prepared from the live estimate worksheet.', 40, 760)

  doc.save(`${slugify(projectName || 'proposal')}-proposal.pdf`)
}
