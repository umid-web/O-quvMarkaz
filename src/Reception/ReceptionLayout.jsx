import { sessionIdentity } from '../api/memoryStore.js';
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { GraduationCap, LogOut, X } from 'lucide-react'
import { navSections } from '../admin/navigation'
import { loadRoles } from '../admin/pages/users-roles/usersStore'
import Header from '../admin/components/Header'
import { logoutFromBackend } from '../api/backend'
import { syncSystemAlerts } from '../admin/activity/systemAlerts'
import './ReceptionLayout.scss'
import { useToast } from '../admin/components/ui/useToast'
import { hasBackendSession } from '../api/backend'
import { useAppSettings } from '../admin/pages/settings/useAppSettings'

export default function ReceptionLayout() {
  const { settings } = useAppSettings()
  const toast = useToast()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    syncSystemAlerts()
  }, [])
  const roleId = sessionIdentity.getItem('educontrol_role')
  const username = sessionIdentity.getItem('educontrol_username') || 'Qabul xodimi'
  const role = useMemo(() => loadRoles().find((item) => item.id === roleId), [roleId])
  const visibleSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter(({ path }) => role?.permissions?.includes(`${path || 'dashboard'}.view`)),
  })).filter((section) => section.items.length)

  const logout = async () => {
    try { await logoutFromBackend() }
    catch (error) { if (hasBackendSession()) { toast.error(error.message); return } }
    sessionIdentity.removeItem('educontrol_logged_in')
    sessionIdentity.removeItem('educontrol_username')
    sessionIdentity.removeItem('educontrol_role')
    sessionIdentity.removeItem('educontrol_user_id')
    navigate('/login', { replace: true })
  }

  return (
    <div className="reception-shell">
      <a className="skip-link" href="#page-content">Asosiy mazmunga o‘tish</a>
      <div className={menuOpen ? 'reception-shell__overlay is-open' : 'reception-shell__overlay'} onClick={() => setMenuOpen(false)} />
      <aside className={menuOpen ? 'reception-sidebar is-open' : 'reception-sidebar'}>
        <div className="reception-sidebar__brand"><span>{settings.org.logo ? <img src={settings.org.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }}/> : <GraduationCap size={19}/>}</span><div><b>{settings.org.name || 'EduControl Pro'}</b><small>QABULXONA</small></div><button onClick={() => setMenuOpen(false)} aria-label="Menyuni yopish"><X size={19}/></button></div>
        <div className="reception-sidebar__profile"><span className="reception-sidebar__avatar">{(sessionIdentity.getItem('educontrol_username') || 'Q').slice(0, 1).toUpperCase()}</span><div><b>{sessionIdentity.getItem('educontrol_username') || 'Qabul xodimi'}</b><small>{role?.name || 'Qabul xodimi'}</small></div><i /></div>
        <nav className="reception-sidebar__nav" aria-label="Ruxsat berilgan bo‘limlar">
          {visibleSections.map((section) => <div className="reception-sidebar__group" key={section.title}><p>{section.title}</p>{section.items.map(({ path, label, icon: Icon }) => <NavLink key={path || 'dashboard'} to={`/reception${path ? `/${path === 'activity' ? 'activity-log' : path}` : ''}`} end={!path} onClick={() => setMenuOpen(false)} className={({ isActive }) => `reception-sidebar__link${isActive ? ' is-active' : ''}`}><Icon size={17}/><span>{label}</span></NavLink>)}</div>)}
        </nav>
        <button className="reception-sidebar__logout" onClick={logout}><LogOut size={17}/> Tizimdan chiqish</button>
      </aside>
      <div className="reception-shell__main">
        <Header onMenuClick={() => setMenuOpen(true)} userName={username} roleName={role?.name || 'Qabul xodimi'} />
        <main id="page-content" className="reception-shell__content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  )
}
