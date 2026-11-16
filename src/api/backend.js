import { memoryCache, sessionIdentity, privateKeys, configureCollectionWriter, publishCollection, clearCollections, migratePrivateCaches, getLegacyRecovery, subscribeCollections } from './memoryStore.js';
import { createDefaultRoles } from '../admin/pages/users-roles/usersData';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const managedKeys = privateKeys;
const pending = new Map();
const pendingBases = new Map();
const stateVersions = new Map();
const stateSnapshots = new Map();
let writableKeys = new Set();
let flushTimer;
let flushPromise = null;
let flushing = false;
let sessionGeneration = 0;
const requests = new Set();
let mutationTail = Promise.resolve();
let lastSyncError = null;
const failedDrafts = new Map();
const failedBases = new Map();
let collectionRevision = 0;
let hydrationSequence = 0;
subscribeCollections(() => { collectionRevision += 1; });
const writeBase = (key) => ({ version: stateVersions.get(key) ?? null, baseRaw: stateSnapshots.get(key) });
const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
export const getSyncError = () => lastSyncError;
export const getSessionGeneration = () => sessionGeneration;
function serializeMutation(job) {
  const generation = sessionGeneration;
  const result = mutationTail.catch(() => {}).then(() => {
    if (generation !== sessionGeneration) throw sessionChanged();
    return job();
  });
  mutationTail = result;
  return result;
}
const sessionChanged = () => Object.assign(new Error('Sessiya o‘zgardi. Qayta urinib ko‘ring.'), { status: 409, code: 'session_changed' });
export const hasBackendSession = () => sessionIdentity.getItem('educontrol_logged_in') === 'true';

export function clearBackendSession() {
  const wasAuthenticated = hasBackendSession();
  sessionGeneration += 1;
  for (const controller of requests) controller.abort();
  requests.clear();
  clearSyncQueue();
  failedDrafts.clear();
  failedBases.clear();
  lastSyncError = null;
  stateVersions.clear();
  stateSnapshots.clear();
  writableKeys.clear();
  sessionIdentity.clear();
  clearCollections();
  if (wasAuthenticated) emit('educontrol:session-cleared');
}

export const canWriteBackendCollection = (key) => hasBackendSession() && writableKeys.has(key);

function queueCollection(key, rawValue) {
  if (memoryCache.getItem(key) === rawValue) return;
  const auxiliary = ['edu-activity-v1', 'edu-notifications-v1'].includes(key);
  if (lastSyncError) { if (auxiliary) return; throw lastSyncError; }
  if (!canWriteBackendCollection(key)) {
    if (auxiliary) return;
    const error = Object.assign(new Error('Permission denied.'), { status: 403 });
    emit('educontrol:sync-error', error.message);
    throw error;
  }
  JSON.parse(rawValue);
  if (!pending.has(key)) pendingBases.set(key, writeBase(key));
  publishCollection(key, rawValue);
  if (stateSnapshots.get(key) === rawValue && !flushing) { pending.delete(key); pendingBases.delete(key); }
  else pending.set(key, rawValue);
  scheduleFlush();
}
configureCollectionWriter(queueCollection);

function scheduleFlush(delay = 250) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flushPending().catch(() => {}); }, delay);
}
export async function flushPending() {
  if (flushPromise) return flushPromise;
  if (!pending.size) {
    if (lastSyncError) throw lastSyncError;
    return;
  }
  if (!hasBackendSession()) throw sessionChanged();
  const generation = sessionGeneration;
  flushing = true;
  const work = serializeMutation(async () => {
    try {
      while (pending.size) {
        if (generation !== sessionGeneration) throw sessionChanged();
        const [key, rawValue] = pending.entries().next().value;
        const base = pendingBases.get(key) ?? writeBase(key);
        pending.delete(key);
        pendingBases.delete(key);
        try { await putState(key, rawValue, base); }
        catch (error) {
          if (generation !== sessionGeneration) throw sessionChanged();
          failedDrafts.set(key, pending.get(key) ?? rawValue);
          failedBases.set(key, pendingBases.get(key) ?? base);
          for (const [draftKey, draft] of pending) {
            failedDrafts.set(draftKey, draft);
            failedBases.set(draftKey, pendingBases.get(draftKey) ?? writeBase(draftKey));
          }
          pending.clear();
          pendingBases.clear();
          // Every subscriber sees the last acknowledged server snapshot again.
          for (const collection of managedKeys) publishCollection(collection, stateSnapshots.get(collection) ?? null);
          lastSyncError = error;
          emit('educontrol:sync-error', error.message);
          emit('educontrol:sync-status');
          throw error;
        }
      }
      lastSyncError = null;
      emit('educontrol:sync-status');
    } finally { if (generation === sessionGeneration) flushing = false; }
  });
  flushPromise = work;
  try { await work; }
  finally { if (flushPromise === work) flushPromise = null; }
}
export async function retryFailedChanges() {
  for (const [key, raw] of failedDrafts) {
    if (canWriteBackendCollection(key)) {
      publishCollection(key, raw);
      pending.set(key, raw);
      pendingBases.set(key, failedBases.get(key) ?? writeBase(key));
    }
  }
  failedDrafts.clear();
  failedBases.clear();
  lastSyncError = null;
  return flushPending();
}
export function discardFailedChanges() {
  failedDrafts.clear();
  failedBases.clear();
  lastSyncError = null;
  emit('educontrol:sync-status');
}
export const hasUnsavedChanges = () => pending.size > 0 || flushing || failedDrafts.size > 0;

export async function refreshBackendState() {
  const generation = sessionGeneration;
  await flushPending();
  if (generation !== sessionGeneration) throw sessionChanged();
  if (pending.size) throw new Error('Saqlanmagan o‘zgarishlar bor. Server aloqasi tiklangach qayta yangilang.');
  const loaded = await hydrateBackendState();
  if (!loaded) throw Object.assign(new Error('Yuklash davomida ma’lumotlar o‘zgardi. O‘zgarishlar saqlangach qayta yangilang.'), { code: 'refresh_interrupted' });
}

export async function syncNotificationsBackend() {
  return syncScopedCollectionBackend('edu-notifications-v1');
}

export async function syncSettingsBackend() {
  const key = 'edu-settings-v1';
  if (!hasBackendSession() || pending.has(key) || failedDrafts.has(key)) return;
  const generation = sessionGeneration;
  const before = memoryCache.getItem(key);
  const { state, versions } = await apiRequest('/state');
  if (generation !== sessionGeneration || pending.has(key) || failedDrafts.has(key) || memoryCache.getItem(key) !== before) return;
  if (!Object.hasOwn(state || {}, key)) return;
  const version = versions?.[key] ?? 0;
  if (version < (stateVersions.get(key) ?? 0)) return;
  const raw = JSON.stringify(state[key]);
  stateVersions.set(key, version);
  stateSnapshots.set(key, raw);
  publishCollection(key, raw);
}

export async function syncActivityBackend() {
  return syncScopedCollectionBackend('edu-activity-v1');
}

async function syncScopedCollectionBackend(key) {
  if (!hasBackendSession() || pending.has(key) || flushing) return;
  const accountId = sessionIdentity.getItem('educontrol_user_id');
  const data = await apiRequest(`/records/${key}`);
  if (!hasBackendSession() || accountId !== sessionIdentity.getItem('educontrol_user_id') || pending.has(key) || flushing || data.version < (stateVersions.get(key) ?? 0)) return;
  const raw = JSON.stringify(data.records ?? []);
  // Record reads report 0 for a collection that has never been saved.
  // State writes require null to create that collection for the first time.
  stateVersions.set(key, data.version || null);
  stateSnapshots.set(key, raw);
  if (memoryCache.getItem(key) === raw) return;
  setMemoryCache(key, data.records ?? []);
  
}

export async function syncChatBackend() {
  if (!hasBackendSession()) throw sessionChanged();
  const generation = sessionGeneration;
  await flushPending();
  if (generation !== sessionGeneration) throw sessionChanged();
  if (pending.has('edu-chat-v1') || pending.has('edu-chat-presence-v1')) throw new Error('Chat o‘zgarishlari serverga hali yuborilmadi.');
  const accountId = sessionIdentity.getItem('educontrol_user_id');
  const chatBefore = memoryCache.getItem('edu-chat-v1');
  const data = await apiRequest('/chat/sync');
  if (accountId !== sessionIdentity.getItem('educontrol_user_id')) throw new Error('Chat sessiyasi o‘zgardi. Qayta ulaning.');
  // A reaction/read receipt may be edited while the polling request is in flight.
  if (pending.has('edu-chat-v1') || flushing || memoryCache.getItem('edu-chat-v1') !== chatBefore) {
    try { data.messages = JSON.parse(memoryCache.getItem('edu-chat-v1') || '[]'); } catch { data.messages = []; }
    return data;
  }
  setMemoryCache('edu-chat-v1', data.messages ?? []);
  setMemoryCache('edu-chat-presence-v1', data.presence ?? {});
  return data;
}

export async function updateChatPresence(tabId, remove = false) {
  const generation = sessionGeneration;
  if (!hasBackendSession()) throw sessionChanged();
  const result = await apiRequest('/chat/presence', {
    method: 'POST',
    body: JSON.stringify({ tabId, remove }),
  });
  if (generation !== sessionGeneration || !hasBackendSession()) throw sessionChanged();
  let presence = {};
  try {
    const parsed = JSON.parse(memoryCache.getItem('edu-chat-presence-v1') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) presence = parsed;
  } catch { /* replace malformed local cache */ }
  const now = Date.now();
  for (const key of Object.keys(presence)) {
    presence[key] = Object.fromEntries(Object.entries(presence[key] || {}).filter(([, time]) => now - Number(time) < 20_000));
    if (!Object.keys(presence[key]).length) delete presence[key];
  }
  if (remove) {
    if (presence[result.actor]) {
      delete presence[result.actor][result.tabId];
      if (!Object.keys(presence[result.actor]).length) delete presence[result.actor];
    }
  } else (presence[result.actor] ??= {})[result.tabId] = result.timestamp;
  setMemoryCache('edu-chat-presence-v1', presence);
  return presence;
}

export async function apiRequest(path, options = {}) {
  const generation = sessionGeneration;
  const controller = new AbortController();
  requests.add(controller);
  try {
    const signals = [controller.signal, AbortSignal.timeout(15_000)];
    if (options.signal) signals.push(options.signal);
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include', ...options, signal: AbortSignal.any(signals),
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionIdentity.getItem('educontrol_user_id') ? { 'X-Educontrol-Account': sessionIdentity.getItem('educontrol_user_id') } : {}),
        ...options.headers,
      },
    });
    let payload;
    try { payload = await response.json(); }
    catch (error) { if (response.ok) throw error; payload = {}; }
    if (generation !== sessionGeneration) throw sessionChanged();
    if (response.status === 401 && hasBackendSession()) {
      clearBackendSession();
      emit('educontrol:session-expired');
    }
    if (!response.ok) {
      const candidate = payload.requestId || response.headers.get('x-request-id');
      const requestId = typeof candidate === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate) ? candidate : undefined;
      const message = payload.message || `Server xatosi (${response.status}).`;
      throw Object.assign(new Error(response.status >= 500 && requestId ? `${message} Murojaat kodi: ${requestId}` : message), { status: response.status, code: payload.error, ...(requestId ? { requestId } : {}) });
    }
    return payload;
  } catch (error) {
    if (generation !== sessionGeneration && error.status !== 401) throw sessionChanged();
    if (error.status) throw error;
    throw new Error('Server bilan aloqa bajarilmadi. Ulanishni tekshirib, qayta urinib ko‘ring.');
  } finally { requests.delete(controller); }
}

async function putState(key, rawValue, baseline = writeBase(key)) {
  const generation = sessionGeneration;
  let value;
  try { value = JSON.parse(rawValue); } catch { return; }
  let result;
  try {
    result = await apiRequest('/state', { method: 'PUT', body: JSON.stringify({ key, value, version: baseline.version }) });
  } catch (error) {
    if (generation !== sessionGeneration) throw sessionChanged();
    if (error.status !== 409 || error.code !== 'version_conflict') throw error;
    const baseRaw = baseline.baseRaw;
    const { state, versions } = await apiRequest('/state');
    if (generation !== sessionGeneration) throw sessionChanged();
    if (baseRaw === undefined || !Object.hasOwn(state, key)) throw error;
    let base;
    try { base = JSON.parse(baseRaw); } catch { throw error; }
    const keyedMerge = (baseItems, localItems, serverItems) => {
      const baseMap = new Map(baseItems);
      const localMap = new Map(localItems);
      const serverMap = new Map(serverItems);
      const merged = new Map();
      const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...serverMap.keys()]);
      for (const id of ids) {
        const inBase = baseMap.has(id);
        const inLocal = localMap.has(id);
        const inServer = serverMap.has(id);
        const baseItem = baseMap.get(id);
        const localItem = localMap.get(id);
        const serverItem = serverMap.get(id);
        const localChanged = inBase !== inLocal || JSON.stringify(baseItem) !== JSON.stringify(localItem);
        const serverChanged = inBase !== inServer || JSON.stringify(baseItem) !== JSON.stringify(serverItem);
        if (localChanged && serverChanged && (inLocal !== inServer || JSON.stringify(localItem) !== JSON.stringify(serverItem))) throw error;
        if (localChanged ? inLocal : inServer) merged.set(id, localChanged ? localItem : serverItem);
      }
      return merged;
    };
    if (Array.isArray(base) && Array.isArray(value) && Array.isArray(state[key])) {
      const idOf = (item) => key === 'edu-schedule-rooms-v1' && typeof item === 'string' ? item : item && (item.id ?? item.code);
      if ([...base, ...value, ...state[key]].some((item) => idOf(item) === undefined || idOf(item) === null)) throw error;
      const asMap = (items) => items.map((item) => [String(idOf(item)), item]);
      value = [...keyedMerge(asMap(base), asMap(value), asMap(state[key])).values()];
    } else if (key === 'edu-chat-presence-v1' && [base, value, state[key]].every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const mergedPresence = {};
      const actors = new Set([...Object.keys(base), ...Object.keys(value), ...Object.keys(state[key])]);
      for (const actor of actors) {
        const baseTabs = base[actor] && typeof base[actor] === 'object' ? base[actor] : {};
        const localTabs = value[actor] && typeof value[actor] === 'object' ? value[actor] : {};
        const serverTabs = state[key][actor] && typeof state[key][actor] === 'object' ? state[key][actor] : {};
        const tabs = keyedMerge(Object.entries(baseTabs), Object.entries(localTabs), Object.entries(serverTabs));
        if (tabs.size) mergedPresence[actor] = Object.fromEntries(tabs);
      }
      value = mergedPresence;
    } else throw error;
    stateVersions.set(key, versions[key] ?? null);
    stateSnapshots.set(key, JSON.stringify(state[key]));
    if (!pending.has(key)) setMemoryCache(key, value);
    result = await apiRequest('/state', { method: 'PUT', body: JSON.stringify({ key, value, version: stateVersions.get(key) ?? null }) });
  }
  if (generation !== sessionGeneration) throw sessionChanged();
  stateVersions.set(key, result.version);
  const savedValue = result.value ?? value;
  stateSnapshots.set(key, JSON.stringify(savedValue));
  if (!pending.has(key)) {
    setMemoryCache(key, savedValue);
  }
  applyServerChanges(result.changes);
  return savedValue;
}

function applyServerChanges(changes = {}) {
  for (const [key, change] of Object.entries(changes)) {
    stateVersions.set(key, change.version);
    stateSnapshots.set(key, JSON.stringify(change.value));
    setMemoryCache(key, change.value);
    
  }
}

let installed = false;
export function initializeClientData() {
  if (installed || typeof window === 'undefined') return;
  // Cleanup is targeted; legacy snapshots stay only in RAM for explicit export.
  migratePrivateCaches();
  installed = true;
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedChanges() || getLegacyRecovery()) { event.preventDefault(); event.returnValue = ''; }
  });
}

export async function hydrateBackendState({ expectedAccountId } = {}) {
  const generation = sessionGeneration;
  const sequence = ++hydrationSequence;
  const revision = collectionRevision;
  const { state, versions, writable } = await apiRequest('/state', {
    headers: expectedAccountId ? { 'X-Educontrol-Account': expectedAccountId } : {},
  });
  if (generation !== sessionGeneration) throw sessionChanged();
  // A read started before a local edit, acknowledged write or newer read must
  // never replace that newer state with its earlier snapshot.
  if (sequence !== hydrationSequence || revision !== collectionRevision || pending.size || flushing) return false;
  stateVersions.clear();
  stateSnapshots.clear();
  writableKeys = new Set(writable ?? []);
  for (const [key, version] of Object.entries(versions ?? {})) stateVersions.set(key, version);
  for (const key of managedKeys) {
    const raw = Object.hasOwn(state, key) ? JSON.stringify(state[key]) : null;
    if (raw !== null) stateSnapshots.set(key, raw);
    publishCollection(key, raw);
  }
  return true;
}

function setMemoryCache(key, value) {
  publishCollection(key, JSON.stringify(value));
}

export const sessionPermissionFingerprint = (user) => JSON.stringify([user.id, user.username, user.roleId, user.roleName, user.teacherId, user.teacherType, [...(user.permissions ?? [])].sort()]);

export function applySessionUser(user) {
  sessionIdentity.setItem('educontrol_permission_fingerprint', sessionPermissionFingerprint(user));
  sessionIdentity.setItem('educontrol_logged_in', 'true');
  sessionIdentity.setItem('educontrol_username', user.username);
  sessionIdentity.setItem('educontrol_role', user.roleId);
  sessionIdentity.setItem('educontrol_user_id', user.id);
  if (user.teacherId) sessionIdentity.setItem('educontrol_teacher_id', user.teacherId);
  else sessionIdentity.removeItem('educontrol_teacher_id');
  if (user.teacherType) sessionIdentity.setItem('educontrol_teacher_type', user.teacherType);
  else sessionIdentity.removeItem('educontrol_teacher_type');
  try {
    const saved = JSON.parse(memoryCache.getItem('edu-roles-v1') || '[]');
    const roles = Array.isArray(saved) ? saved : [];
    const index = roles.findIndex((role) => role.id === user.roleId);
    const role = { ...(index >= 0 ? roles[index] : {}), id: user.roleId, name: user.roleName, permissions: user.permissions ?? [] };
    if (index >= 0) roles[index] = role;
    else roles.push(role);
    setMemoryCache('edu-roles-v1', roles);
  } catch { /* API tekshiruvlari serverda bajariladi */ }
  emit('educontrol:session-ready');
}

export async function loginToBackend(username, password) {
  clearBackendSession();
  const generation = sessionGeneration;
  const { user } = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  try {
    await hydrateBackendState({ expectedAccountId: user.id });
    if (user.roleId === 'owner' && !stateSnapshots.has('edu-roles-v1')) {
      const roles = createDefaultRoles();
      const result = await apiRequest('/state', { method: 'PUT', headers: { 'X-Educontrol-Account': user.id }, body: JSON.stringify({ key: 'edu-roles-v1', value: roles, version: null }) });
      stateVersions.set('edu-roles-v1', result.version);
      stateSnapshots.set('edu-roles-v1', JSON.stringify(roles));
      setMemoryCache('edu-roles-v1', roles);
    }
  } catch (error) {
    if (generation !== sessionGeneration) throw sessionChanged();
    await apiRequest('/auth/logout', { method: 'POST', body: {}, headers: { 'X-Educontrol-Account': user.id } }).catch(() => {});
    if (generation === sessionGeneration) clearBackendSession();
    throw error;
  }
  if (generation !== sessionGeneration) throw sessionChanged();
  applySessionUser(user);
  return user;
}

export async function createBackendAccount(account) {
  if (!hasBackendSession()) throw sessionChanged();
  const generation = sessionGeneration;
  await flushPending();
  if (generation !== sessionGeneration) throw sessionChanged();
  if (pending.size) throw new Error('Avvalgi o‘zgarishlar hali saqlanmadi. Server aloqasini tekshiring.');
  return serializeMutation(async () => {
    const { user, version, changes } = await apiRequest('/admin/accounts', { method: 'POST', body: JSON.stringify(account) });
    if (generation !== sessionGeneration) throw sessionChanged();
    applyServerChanges(changes);
    const key = 'edu-users-v1';
    let previous = [];
    try { previous = JSON.parse(stateSnapshots.get(key) ?? '[]'); } catch { /* no prior snapshot */ }
    stateVersions.set(key, version);
    const savedUsers = [user, ...previous.filter((item) => item.id !== user.id)];
    stateSnapshots.set(key, JSON.stringify(savedUsers));
    if (!pending.has(key)) setMemoryCache(key, savedUsers);
    return user;
  });
}

export async function saveBackendUsers(users) {
  return saveBackendCollection('edu-users-v1', users);
}

export async function saveBackendCollection(key, value) {
  if (!hasBackendSession()) throw sessionChanged();
  const generation = sessionGeneration;
  const base = writeBase(key);
  await flushPending();
  if (generation !== sessionGeneration) throw sessionChanged();
  if (pending.size) throw new Error('Avvalgi o‘zgarishlar hali saqlanmadi. Server aloqasini tekshiring.');
  return serializeMutation(() => putState(key, JSON.stringify(value), base));
}

function clearSyncQueue() {
  clearTimeout(flushTimer);
  pending.clear();
  pendingBases.clear();
  flushing = false;
  flushPromise = null;
  mutationTail = Promise.resolve();
}

export async function logoutFromBackend() {
  const generation = sessionGeneration;
  const accountId = sessionIdentity.getItem('educontrol_user_id');
  // Do not silently discard the current tab's unacknowledged work.
  await flushPending();
  if (generation !== sessionGeneration) throw sessionChanged();
  // Stop requests and hide account data before awaiting the logout response.
  clearBackendSession();
  return apiRequest('/auth/logout', { method: 'POST', body: {}, headers: accountId ? { 'X-Educontrol-Account': accountId } : {} });
}
