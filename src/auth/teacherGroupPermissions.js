export const TEACHER_GROUP_PERMISSIONS = ['groups.view'];

export function ensureTeacherGroupAccess(roles) {
  return roles.map((role) => role.id !== 'teacher' ? role : {
    ...role,
    permissions: [...new Set([...(Array.isArray(role.permissions) ? role.permissions : []), ...TEACHER_GROUP_PERMISSIONS])],
  });
}
