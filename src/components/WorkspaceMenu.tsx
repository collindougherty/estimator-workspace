import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const workspaceMenuItems = [
  {
    description: 'Account and workspace defaults',
    label: 'Settings',
    to: '/settings',
  },
  {
    description: 'Labor, equipment, and material prefills',
    label: 'Company library',
    to: '/company-library',
  },
  {
    description: 'Prototype stocked-material workflow',
    label: 'Inventory',
    to: '/inventory',
  },
]

export const WorkspaceMenu = () => {
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isOpen])

  return (
    <div className="workspace-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Open workspace menu"
        className={'workspace-menu-button' + (isOpen ? ' workspace-menu-button-open' : '')}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="workspace-menu-icon">
          <span />
          <span />
          <span />
        </span>
      </button>

      {isOpen ? (
        <div className="workspace-menu-popover" role="menu">
          {workspaceMenuItems.map((item) => {
            const isActive = location.pathname === item.to

            return (
              <Link
                aria-current={isActive ? 'page' : undefined}
                className={'workspace-menu-item' + (isActive ? ' workspace-menu-item-active' : '')}
                key={item.to}
                onClick={() => setIsOpen(false)}
                role="menuitem"
                to={item.to}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
