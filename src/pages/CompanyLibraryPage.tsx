import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { CompanyLibraryPanel } from '../components/CompanyLibraryPanel'
import { WorkspaceMenu } from '../components/WorkspaceMenu'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLibrary } from '../hooks/useCompanyLibrary'
import { fetchOrganizations } from '../lib/api'
import { buildUnitOptions } from '../lib/item-detail'
import type { Organization } from '../lib/models'

export const CompanyLibraryPage = () => {
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
          caughtError instanceof Error ? caughtError.message : 'Unable to load company library'
        setScreenError(message)
      } finally {
        setIsLoading(false)
      }
    }

    void loadOrganizations()
  }, [])

  const activeOrganization = organizations[0] ?? null
  const {
    createEmployee,
    createEquipment,
    createMaterial,
    deleteEmployee,
    deleteEquipment,
    deleteMaterial,
    employees,
    equipment,
    isBusy,
    materials,
  } = useCompanyLibrary({
    onError: setScreenError,
    organizationId: activeOrganization?.id,
  })

  const unitOptions = useMemo(
    () => buildUnitOptions(undefined, materials.map((material) => material.unit ?? '')),
    [materials],
  )

  return (
    <main className="app-screen app-screen-compact">
      <header className="topbar topbar-simple">
        <div className="project-header-copy">
          <Link className="back-link" to="/">
            ← Back
          </Link>
          <p className="eyebrow">ProfitBuilder</p>
          <h1>Company library</h1>
          <p className="project-meta-line">
            <span>{activeOrganization?.name ?? 'No organization yet'}</span>
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
          <div className="panel-empty">Loading company library…</div>
        </article>
      ) : !activeOrganization ? (
        <article className="panel">
          <div className="panel-empty">
            Create an organization first, then manage company prefills here.
          </div>
        </article>
      ) : (
        <section className="utility-stack">
          <article className="panel panel-compact utility-context-panel">
            <div>
              <p className="eyebrow">Current company</p>
              <h2>{activeOrganization.name}</h2>
              <p className="panel-meta">
                Update the labor, equipment, and material defaults that feed the bid builder and
                tracking editors.
              </p>
            </div>
          </article>

          <CompanyLibraryPanel
            employees={employees}
            equipment={equipment}
            isBusy={isBusy}
            materials={materials}
            onCreateEmployee={createEmployee}
            onCreateEquipment={createEquipment}
            onCreateMaterial={createMaterial}
            onDeleteEmployee={deleteEmployee}
            onDeleteEquipment={deleteEquipment}
            onDeleteMaterial={deleteMaterial}
            unitOptions={unitOptions}
          />
        </section>
      )}
    </main>
  )
}
