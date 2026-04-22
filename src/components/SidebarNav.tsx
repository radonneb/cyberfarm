import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/create-field', label: 'Create' },
  { to: '/generate-lines', label: 'Generate' },
  { to: '/edit-field', label: 'Edit' },
  { to: '/export', label: 'Export' },
  { to: '/ai-export', label: 'AI Export' },
]

export default function SidebarNav() {
  return (
    <nav className="top-nav-inline" aria-label="Primary navigation">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-btn compact-nav-btn ${isActive ? 'active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
