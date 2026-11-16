export const ADMIN_ACCOUNT_CREATION_PERMISSIONS = ['users-roles.view', 'users-roles.create'];

export function ensureAdminAccountCreation(roles) {
  return roles.map((role) => role.id !== 'admin' || ADMIN_ACCOUNT_CREATION_PERMISSIONS.every((permission) => role.permissions?.includes(permission))
    ? role
    : { ...role, permissions: [...new Set([...(role.permissions ?? []), ...ADMIN_ACCOUNT_CREATION_PERMISSIONS])] });
}
