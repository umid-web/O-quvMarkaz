import { fail } from './http.js';

// Bound both the request count and the number of tracked clients.
export function createTrafficGuard({ limit = 1200, windowMs = 60_000, maxClients = 10_000, maxInFlight = 100, clock = Date.now } = {}) {
  const clients = new Map();
  let inFlight = 0;
  let nextCleanup = 0;
  return (req, res) => {
    const now = clock();
    if (now >= nextCleanup) {
      for (const [key, bucket] of clients) if (bucket.until <= now) clients.delete(key);
      nextCleanup = now + windowMs;
    }
    const key = req.socket.remoteAddress || 'unknown';
    let bucket = clients.get(key);
    if (!bucket || bucket.until <= now) {
      if (!bucket && clients.size >= maxClients) {
        res.setHeader('Retry-After', '60');
        throw fail(503, 'server_busy', 'Server busy. Retry later.');
      }
      bucket = { count: 0, until: now + windowMs };
      clients.set(key, bucket);
    }
    if (bucket.count >= limit || inFlight >= maxInFlight) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.until - now) / 1000))));
      throw fail(429, 'rate_limited', 'Too many requests. Retry later.');
    }
    bucket.count += 1;
    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
      res.off('finish', release);
      res.off('close', release);
    };
    res.once('finish', release);
    res.once('close', release);
  };
}

export const guardTraffic = createTrafficGuard();
