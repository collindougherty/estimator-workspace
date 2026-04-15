import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { MetricCard } from '../components/MetricCard'
import { WorkspaceMenu } from '../components/WorkspaceMenu'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLibrary } from '../hooks/useCompanyLibrary'
import { fetchOrganizations } from '../lib/api'
import { formatCurrency } from '../lib/formatters'
import type { Organization } from '../lib/models'

type InventoryRow = {
  available: number
  item: string
  onHand: number
  reorderPoint: number
  reserved: number
  unit: string
  unitCost: number
}

const fallbackInventoryRows: InventoryRow[] = [
  {
    available: 42,
    item: 'Architectural shingles',
    onHand: 54,
    reorderPoint: 20,
    reserved: 12,
    unit: 'SQ',
    unitCost: 36,
  },
  {
    available: 16,
    item: 'Ice and water shield',
    onHand: 22,
    reorderPoint: 10,
    reserved: 6,
    unit: 'ROLL',
    unitCost: 78,
  },
  {
    available: 28,
    item: 'Drip edge',
    onHand: 40,
    reorderPoint: 18,
    reserved: 12,
    unit: 'LF',
    unitCost: 2.8,
  },
  {
    available: 9,
    item: 'Starter strip bundles',
    onHand: 14,
    reorderPoint: 12,
    reserved: 5,
    unit: 'EA',
    unitCost: 24,
  },
]

export const InventoryPage = () => {
  const { signOutUser, user } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [screenError, setScreenError] = useState<string | null>(null)

  useEffect(() => {
    const loadOrganizations = async () => {
      setIsLoading(true)
      setScreenError(null)

      try {
        const nextOrganizations = await fetchOrganizations()
        setOrganizations(nextOrganizations)
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : 'Unable to load inventory prototype'
        setScreenError(message)
      } finally {
        setIsLoading(false)
      }
    }

    void loadOrganizations()
  }, [])

  const activeOrganization = organizations[0] ?? null
  const { materials } = useCompanyLibrary({
    onError: setScreenError,
    organizationId: activeOrganization?.id,
  })

  const inventoryRows = useMemo(() => {
    const derivedRows = materials.slice(0, 6).map((material, index) => {
      const onHand = 52 - index * 6
      const reserved = 8 + (index % 3) * 5
      const available = Math.max(onHand - reserved, 0)
      const reorderPoint = 14 + index * 2

      return {
        available,
        item: material.name,
        onHand,
        reorderPoint,
        reserved,
        unit: material.unit,
        unitCost: material.cost_per_unit ?? 0,
      }
    })

    return derivedRows.length > 0 ? derivedRows : fallbackInventoryRows
  }, [materials])

  const prototypeSummary = useMemo(() => {
    return inventoryRows.reduce(
      (summary, row) => {
        summary.items += 1
        summary.availableValue += row.available * row.unitCost
        summary.reserved += row.reserved

        if (row.available <= row.reorderPoint) {
          summary.reorderSoon += 1
        }

        return summary
      },
      {
        availableValue: 0,
        items: 0,
        reorderSoon: 0,
        reserved: 0,
      },
    )
  }, [inventoryRows])

  return (
    <main className="app-screen app-screen-compact">
      <header className="topbar topbar-simple">
        <div className="project-header-copy">
          <Link className="back-link" to="/">
            ← Back
          </Link>
          <p className="eyebrow">ProfitBuilder</p>
          <h1>Inventory</h1>
          <p className="project-meta-line">
            <span>{activeOrganization?.name ?? 'Prototype view'}</span>
            <span>{user?.email ?? 'Signed in'}</span>
          </p>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => void signOutUser()} type="button">
            Sign out
          </button>
          <WorkspaceMenu />
        </div>
      </header>

      {screenError ? <p className="screen-error">{screenError}</p> : null}

      {isLoading ? (
        <article className="panel">
          <div className="panel-empty">Loading inventory prototype…</div>
        </article>
      ) : (
        <section className="utility-stack">
          <article className="panel panel-compact utility-context-panel">
            <div>
              <p className="eyebrow">Prototype</p>
              <h2>Stocked materials workflow</h2>
              <p className="panel-meta">
                This is a layout prototype for tracking what is on hand, what is already committed
                to active jobs, and what needs reordering next. Counts are illustrative until we add
                real inventory tables.
              </p>
            </div>
          </article>

          <section className="metrics-grid">
            <MetricCard
              label="Tracked items"
              note="Prototype material lines"
              value={String(prototypeSummary.items)}
            />
            <MetricCard
              label="Available value"
              note="On hand minus reserved"
              value={formatCurrency(prototypeSummary.availableValue)}
            />
            <MetricCard
              label="Reorder soon"
              note={`${prototypeSummary.reserved} units reserved`}
              value={String(prototypeSummary.reorderSoon)}
            />
          </section>

          <article className="panel panel-table">
            <div className="panel-heading panel-heading-compact">
              <div>
                <h2>Stock view</h2>
                <p className="panel-meta">
                  Start with common materials, then add purchase orders, allocations, and receive
                  counts once the backend tables exist.
                </p>
              </div>
              <span className="section-count">{inventoryRows.length}</span>
            </div>

            <div className="project-list-shell inventory-table-shell">
              <table className="project-list-table inventory-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>On hand</th>
                    <th>Reserved</th>
                    <th>Available</th>
                    <th>Reorder at</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((row) => {
                    const needsReorder = row.available <= row.reorderPoint

                    return (
                      <tr key={row.item}>
                        <td className="project-list-primary">
                          <strong>{row.item}</strong>
                          <span className="project-list-subtext">
                            {row.unit} · {formatCurrency(row.unitCost)} / unit
                          </span>
                        </td>
                        <td>{row.onHand}</td>
                        <td>{row.reserved}</td>
                        <td>{row.available}</td>
                        <td>{row.reorderPoint}</td>
                        <td>
                          <span
                            className={
                              'inventory-status-chip' +
                              (needsReorder
                                ? ' inventory-status-chip-warning'
                                : ' inventory-status-chip-healthy')
                            }
                          >
                            {needsReorder ? 'Reorder soon' : 'Healthy'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}
    </main>
  )
}
