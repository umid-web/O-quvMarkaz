import { useEffect, useState } from 'react';

export function useCurrentTime() {
  const [timestamp, setTimestamp] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setTimestamp(Date.now());
    const timer = setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  return timestamp;
}
