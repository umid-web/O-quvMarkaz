import { useEffect, useRef, useState } from 'react';

export function useTableSelection(rows, idKey = 'id') {
  const [selected, setSelected] = useState(() => new Set());
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row[idKey]));
  const pageSome = rows.some((row) => selected.has(row[idKey]));
  const headCheckbox = useRef(null);
  useEffect(() => {
    if (headCheckbox.current) headCheckbox.current.indeterminate = pageSome && !pageSelected;
  }, [pageSome, pageSelected]);

  const toggleOne = (id) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const togglePage = () => setSelected((previous) => {
    const next = new Set(previous);
    rows.forEach((row) => pageSelected ? next.delete(row[idKey]) : next.add(row[idKey]));
    return next;
  });
  return { selected, setSelected, pageSelected, headCheckbox, toggleOne, togglePage };
}
