import { useCallback } from 'react';
import { memoryCache, readCollectionSnapshot, useCollectionState } from '../../api/memoryStore.js';

export function loadEntityCollection(key) {
  try {
    const value = JSON.parse(memoryCache.getItem(key));
    if (Array.isArray(value)) return value;
  } catch { /* Missing or invalid collection. */ }
  return [];
}

// Keep actions stable, but read current records when an action runs.
export function useEntityCollection({ storageKey, log, prefix, statuses, idKey = 'id' }) {
  const [items, setItems] = useCollectionState(storageKey);
  const add = useCallback((data) => {
    let created = data;
    if (prefix) {
      const max = readCollectionSnapshot(storageKey).reduce(
        (value, item) => Math.max(value, Number(String(item.id).replace(/\D/g, '')) || 0), 0);
      created = { ...data, id: `${prefix}${String(max + 1).padStart(4, '0')}` };
    }
    setItems((list) => [created, ...list]);
    log.created(created);
    return created;
  }, [setItems, storageKey, log, prefix]);

  const update = useCallback((id, patch) => {
    const before = readCollectionSnapshot(storageKey).find((item) => item[idKey] === id);
    setItems((list) => list.map((item) => item[idKey] === id ? { ...item, ...patch } : item));
    log.updated(before, patch);
  }, [setItems, storageKey, log, idKey]);

  const remove = useCallback((ids) => {
    const selected = new Set(ids);
    const removed = readCollectionSnapshot(storageKey).filter((item) => selected.has(item[idKey]));
    setItems((list) => list.filter((item) => !selected.has(item[idKey])));
    log.deleted(removed);
    return removed;
  }, [setItems, storageKey, log, idKey]);

  const restore = useCallback((restored) => {
    const ids = new Set(restored.map((item) => item[idKey]));
    setItems((list) => [...restored, ...list.filter((item) => !ids.has(item[idKey]))]);
    log.restored(restored);
  }, [setItems, log, idKey]);

  const setStatus = useCallback((ids, status) => {
    const selected = new Set(ids);
    const before = readCollectionSnapshot(storageKey).filter((item) => selected.has(item[idKey]));
    setItems((list) => list.map((item) => selected.has(item[idKey]) ? { ...item, status } : item));
    log.statusChanged(before, status, statuses?.[status]?.label);
  }, [setItems, storageKey, log, idKey, statuses]);

  return { items, add, update, remove, restore, ...(statuses ? { setStatus } : {}) };
}
