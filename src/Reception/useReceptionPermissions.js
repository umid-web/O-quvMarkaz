import { sessionIdentity } from '../api/memoryStore.js';
import { useLocation } from 'react-router-dom'
import { loadRoles } from '../admin/pages/users-roles/usersStore'
import { hasBackendSession } from '../api/backend'

export default function useReceptionPermissions() {
  const { pathname } = useLocation()
  const isScopedRole = pathname.startsWith('/reception') || pathname.startsWith('/teacher')
  const roleId = sessionIdentity.getItem('educontrol_role')
  const permissions = new Set(loadRoles().find((role) => role.id === roleId)?.permissions ?? [])
  return (module, action = 'view') => {
    return roleId === 'owner' || (!hasBackendSession() && !isScopedRole) || permissions.has(`${module}.${action}`)
  }
}
