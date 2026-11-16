import { fail } from './http.js';

export function assertCanManageRole(actor, target, granted) {
  if (actor.role_id === 'owner') return;
  if (target === 'owner' || granted.some((permission) => !actor.permissions.includes(permission))) {
    throw fail(403, 'permission_escalation', 'Cannot manage an account or role with higher privileges.');
  }
}
