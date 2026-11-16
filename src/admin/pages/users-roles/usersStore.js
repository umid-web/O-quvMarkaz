import { useCollectionState, memoryCache, sessionIdentity, readCollectionSnapshot } from '../../../api/memoryStore.js';
import { useCallback, useRef } from 'react';
import { createLogger, diffObjects, logActivity } from '../../activity/activityStore';
import { pushNotification } from '../../activity/notificationStore';
import { createDefaultRoles, defaultPermissions, normalizeRoles, USER_STATUSES, userName } from './usersData';
import { hasBackendSession, saveBackendUsers, saveBackendCollection } from '../../../api/backend';

// Server-backed data is held only in the tab-local React store.
const USERS_KEY = 'edu-users-v1';
const ROLES_KEY = 'edu-roles-v1';

const read = (key) => {
  try {
    const parsed = JSON.parse(memoryCache.getItem(key));
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* buzilgan yoki mavjud bo‘lmagan ma'lumot */
  }
  return null;
};

export const loadRoles = () => normalizeRoles(read(ROLES_KEY) ?? createDefaultRoles());
export const loadUsers = () => {
  const saved = read(USERS_KEY);
  if (saved) return saved;
  if (!hasBackendSession()) return [];
  if (sessionIdentity.getItem('educontrol_role') !== 'owner') return [];
  const username = sessionIdentity.getItem('educontrol_username') || 'Administrator';
  return [{
    id: sessionIdentity.getItem('educontrol_user_id') || 'owner', firstName: username, lastName: 'Administrator',
    email: '', phone: '', login: username, roleId: 'owner', status: 'active', createdAt: today(), lastLoginAt: '', note: 'Tizim egasi',
  }];
};

const nextUserId = (list) => {
  const max = list.reduce((m, u) => Math.max(m, Number(String(u.id).replace(/\D/g, '')) || 0), 0);
  return `U-${String(max + 1).padStart(4, '0')}`;
};

// Faoliyat tarixi. Foydalanuvchi va rollar bilan bog‘liq amallar xavfsizlik uchun muhim —
// ba’zilari (bloklash, rol o‘zgarishi, o‘chirish) bildirishnoma ham yaratadi.
const userLog = createLogger({
  module: 'users',
  noun: 'Foydalanuvchi',
  nameOf: userName,
  ignore: ['lastLoginAt', 'createdAt', 'password', 'passwordHash'],
  notifyCreate: (u) => ({
    recipientIds: [u.id],
    category: 'security',
    priority: 'normal',
    title: 'Yangi foydalanuvchi qo‘shildi',
    message: `${userName(u)} · ${u.email}`,
    link: '/admin/users-roles',
  }),
});
const roleLog = createLogger({ module: 'roles', noun: 'Rol', nameOf: (r) => r.name, ignore: ['permissions', 'locked', 'system'] });

const security = (title, message) =>
  pushNotification({ category: 'security', priority: 'high', title, message, link: '/admin/users-roles' });

const today = () => new Date().toISOString().slice(0, 10);

/** Foydalanuvchilar va rollar — bitta joyda, chunki ular o‘zaro bog‘liq (rol o‘chirilganda, foydalanuvchi soni va h.k.). */
export const useAccess = () => {
  const [users, setUsers] = useCollectionState(USERS_KEY);
  const [roles, setRoles] = useCollectionState(ROLES_KEY);
  const savingUsers = useRef(false);
  const savingRoles = useRef(false);
  const saveRoles = useCallback(async (nextRoles) => {
    if (savingRoles.current) throw new Error('Rol saqlanmoqda. Bir oz kuting.');
    savingRoles.current = true;
    try {
      const saved = hasBackendSession() ? await saveBackendCollection(ROLES_KEY, nextRoles) : nextRoles;
      setRoles(saved);
      window.dispatchEvent(new Event('educontrol:roles-saved'));
    } finally { savingRoles.current = false; }
  }, [setRoles]);
  const saveUsers = useCallback(async (nextUsers) => {
    if (savingUsers.current) throw new Error('Avvalgi o‘zgarish saqlanmoqda. Bir oz kuting.');
    savingUsers.current = true;
    try {
      const savedUsers = hasBackendSession() ? await saveBackendUsers(nextUsers) : nextUsers;
      setUsers(savedUsers);
    } finally { savingUsers.current = false; }
  }, [setUsers]);



  /* ---------- Foydalanuvchilar ---------- */
  const addUser = useCallback((data) => {
    const created = { ...data, id: data.id ?? nextUserId(readCollectionSnapshot(USERS_KEY)), createdAt: data.createdAt ?? today(), lastLoginAt: data.lastLoginAt ?? '' };
    setUsers((list) => [created, ...list.filter((user) => user.id !== created.id)]);
    userLog.created(created);
    return created;
  }, [setUsers]);

  const updateUser = useCallback(async (id, patch) => {
    const before = readCollectionSnapshot(USERS_KEY).find((u) => u.id === id);
    await saveUsers(readCollectionSnapshot(USERS_KEY).map((u) => u.id === id ? { ...u, ...patch } : u));
    userLog.updated(before, patch);
    if (before && patch.roleId && patch.roleId !== before.roleId) {
      const name = (rid) => readCollectionSnapshot(ROLES_KEY).find((r) => r.id === rid)?.name ?? rid;
      security('Foydalanuvchi roli o‘zgartirildi', `${userName(before)}: ${name(before.roleId)} → ${name(patch.roleId)}`);
    }
  }, [saveUsers]);

  // O‘chirilgan yozuvlarni qaytaradi — "Qaytarish" (undo) uchun
  const removeUsers = useCallback(async (ids) => {
    const set = new Set(ids);
    const removed = readCollectionSnapshot(USERS_KEY).filter((u) => set.has(u.id));
    await saveUsers(readCollectionSnapshot(USERS_KEY).filter((u) => !set.has(u.id)));
    userLog.deleted(removed);
    if (removed.length) security('Foydalanuvchi o‘chirildi', removed.length === 1 ? userName(removed[0]) : `${removed.length} ta foydalanuvchi`);
    return removed;
  }, [saveUsers]);

  const restoreUsers = useCallback(async (items) => {
    await saveUsers([...items, ...readCollectionSnapshot(USERS_KEY).filter((u) => !items.some((i) => i.id === u.id))]);
    userLog.restored(items);
  }, [saveUsers]);

  const setUsersStatus = useCallback(async (ids, status) => {
    const set = new Set(ids);
    const affected = readCollectionSnapshot(USERS_KEY).filter((u) => set.has(u.id) && u.status !== status);
    await saveUsers(readCollectionSnapshot(USERS_KEY).map((u) => set.has(u.id) ? { ...u, status } : u));
    userLog.statusChanged(affected, status, USER_STATUSES[status]?.label);
    if (status === 'blocked' && affected.length) {
      security('Foydalanuvchi bloklandi', affected.length === 1 ? userName(affected[0]) : `${affected.length} ta foydalanuvchi`);
    }
  }, [saveUsers]);

  const setUsersRole = useCallback(async (ids, roleId) => {
    const set = new Set(ids);
    const affected = readCollectionSnapshot(USERS_KEY).filter((u) => set.has(u.id) && u.roleId !== roleId);
    await saveUsers(readCollectionSnapshot(USERS_KEY).map((u) => set.has(u.id) ? { ...u, roleId, ...(roleId !== 'teacher' ? { teacherId: '', teacherType: '' } : {}) } : u));
    const roleName = (rid) => readCollectionSnapshot(ROLES_KEY).find((r) => r.id === rid)?.name ?? rid;
    if (affected.length) {
      const single = affected.length === 1;
      logActivity({
        module: 'users',
        action: 'security',
        severity: 'warning',
        title: single
          ? `Foydalanuvchi roli o‘zgartirildi: ${userName(affected[0])} → ${roleName(roleId)}`
          : `${affected.length} ta foydalanuvchi roli o‘zgartirildi → ${roleName(roleId)}`,
        entityId: single ? affected[0].id : '',
        entityName: single ? userName(affected[0]) : '',
        changes: single ? [{ field: 'roleId', label: 'Rol', from: roleName(affected[0].roleId), to: roleName(roleId) }] : [],
        items: single ? [] : affected.map((u) => ({ id: u.id, name: userName(u) })),
      });
    }
  }, [saveUsers]);

  /* ---------- Rollar ---------- */
  const addRole = useCallback(async (data) => {
    const created = { ...data, id: `custom-${Date.now().toString(36)}`, system: false, locked: false };
    await saveRoles([...readCollectionSnapshot(ROLES_KEY), created]);
    roleLog.created(created);
    return created;
  }, [saveRoles]);

  const updateRole = useCallback(async (id, patch) => {
    const before = readCollectionSnapshot(ROLES_KEY).find((r) => r.id === id);
    await saveRoles(readCollectionSnapshot(ROLES_KEY).map((r) => r.id === id ? { ...r, ...patch } : r));
    if (before) {
      const changes = diffObjects(before, patch, { ignore: ['permissions', 'locked', 'system'] });
      const permsChanged = patch.permissions !== undefined && JSON.stringify(patch.permissions) !== JSON.stringify(before.permissions);
      if (permsChanged) changes.push({ field: 'permissions', label: 'Ruxsatlar', from: 'oldingi', to: 'yangilandi' });
      if (changes.length) {
        logActivity({
          module: 'roles',
          action: permsChanged ? 'security' : 'update',
          severity: permsChanged ? 'warning' : 'info',
          title: `Rol tahrirlandi: ${patch.name ?? before.name}`,
          entityId: id,
          entityName: patch.name ?? before.name,
          changes,
        });
        if (permsChanged) security('Rol ruxsatlari o‘zgartirildi', patch.name ?? before.name);
      }
    }
  }, [saveRoles]);

  const removeRole = useCallback(async (id) => {
    const removed = readCollectionSnapshot(ROLES_KEY).find((r) => r.id === id) ?? null;
    await saveRoles(readCollectionSnapshot(ROLES_KEY).filter((r) => r.id !== id));
    if (removed) {
      roleLog.deleted([removed]);
      security('Rol o‘chirildi', removed.name);
    }
    return removed;
  }, [saveRoles]);

  const restoreRole = useCallback(async (role) => {
    await saveRoles(readCollectionSnapshot(ROLES_KEY).some((r) => r.id === role.id) ? readCollectionSnapshot(ROLES_KEY) : [...readCollectionSnapshot(ROLES_KEY), role]);
    roleLog.restored([role]);
  }, [saveRoles]);

  const resetRole = useCallback(async (id) => {
    const permissions = defaultPermissions(id);
    const role = readCollectionSnapshot(ROLES_KEY).find((r) => r.id === id);
    if (permissions) await saveRoles(readCollectionSnapshot(ROLES_KEY).map((r) => r.id === id ? { ...r, permissions } : r));
    if (permissions && role) {
      logActivity({
        module: 'roles',
        action: 'security',
        severity: 'warning',
        title: `Rol ruxsatlari standart holatga qaytarildi: ${role.name}`,
        entityId: id,
        entityName: role.name,
      });
    }
  }, [saveRoles]);


  return {
    users, roles,
    addUser, updateUser, removeUsers, restoreUsers, setUsersStatus, setUsersRole,
    addRole, updateRole, removeRole, restoreRole, resetRole,
  };
};
