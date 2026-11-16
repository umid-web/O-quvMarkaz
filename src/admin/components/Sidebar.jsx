import { sessionIdentity } from '../../api/memoryStore.js';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, X } from 'lucide-react';
import { navSections } from '../navigation';
import { loadRoles } from '../pages/users-roles/usersStore';
import { useAppSettings } from '../pages/settings/useAppSettings';
import { useNotifications } from '../activity/notificationStore';
import { logoutFromBackend } from '../../api/backend';
import './Sidebar.scss';
import { useToast } from './ui/useToast';
import { hasBackendSession } from '../../api/backend';

const Sidebar = ({ open = false, onClose = () => {} }) => {
  const toast = useToast();
  const { settings } = useAppSettings();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isTeacher = sessionIdentity.getItem('educontrol_role') === 'teacher' || pathname.startsWith('/teacher');
  const basePath = isTeacher ? '/teacher' : '/admin';
  const role = loadRoles().find((item) => item.id === sessionIdentity.getItem('educontrol_role'));
  const sections = navSections.map((section) => ({
    ...section,
    items: section.items.filter(({ path }) => {
      const module = path || 'dashboard';
      return role?.permissions?.includes(`${module}.view`);
    }),
  })).filter((section) => section.items.length);
  const orgName = settings?.org?.name?.trim() || 'EduControl Pro';
  const logo = settings?.org?.logo;
  const logout = async () => {
    try { await logoutFromBackend(); }
    catch (error) { if (hasBackendSession()) { toast.error(error.message); return; } }
    ['educontrol_logged_in', 'educontrol_username', 'educontrol_role', 'educontrol_user_id', 'educontrol_teacher_id', 'educontrol_teacher_type'].forEach((key) => sessionIdentity.removeItem(key));
    navigate('/login', { replace: true });
  };

  return (
  <>
    <div
      className={open ? 'sidebar-overlay is-visible' : 'sidebar-overlay'}
      onClick={onClose}
      aria-hidden="true"
    />
    <aside className={open ? 'admin-sidebar is-open' : 'admin-sidebar'} aria-label="Asosiy menyu">
      <div className="admin-sidebar__brand">
        <span className={logo ? 'admin-sidebar__logo admin-sidebar__logo--image' : 'admin-sidebar__logo'}>
          {logo ? <img src={logo} alt="" /> : <GraduationCap size={20} />}
        </span>
        <span className="admin-sidebar__name">{orgName}</span>
        <button
          type="button"
          className="admin-sidebar__close"
          onClick={onClose}
          aria-label="Menyuni yopish"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="admin-sidebar__nav">
        {sections.map((section) => (
          <div className="menu-group" key={section.title}>
            <div className="menu-group__title">{section.title}</div>
            {section.items.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path || 'dashboard'}
                to={`${basePath}${path ? `/${path === 'activity' ? 'activity-log' : path}` : ''}`}
                end={path === ''}
                onClick={onClose}
                className={({ isActive }) => (isActive ? 'menu-item active' : 'menu-item')}
              >
                <Icon size={18} className="menu-item__icon" />
                <span className="menu-item__label">{label}</span>
                {path === 'notifications' && unread > 0 && (
                  <span className="menu-item__badge" aria-label={`${unread} ta o‘qilmagan`}>{unread > 99 ? '99+' : unread}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <button type="button" className="admin-sidebar__logout" onClick={logout}>
        <LogOut size={17} /> Tizimdan chiqish
      </button>
    </aside>
  </>
  );
};

export default Sidebar;
