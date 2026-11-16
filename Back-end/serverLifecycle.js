import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { json } from './http.js';

// Error messages, URLs and request data may contain personal information.
// Keep only the technical code and source locations in operational logs.
export function safeErrorDetails(error) {
  const type = /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(error?.name || '') ? error.name : 'Error';
  const code = /^ERR_[A-Z0-9_]{1,70}$/.test(error?.code || '') || ['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES', 'EMFILE', 'ENFILE', 'ENOSPC', 'ECONNRESET', 'EPIPE'].includes(error?.code) ? error.code : undefined;
  const locations = typeof error?.stack === 'string'
    ? [...error.stack.split('\n').slice(1).join('\n').matchAll(/[/\\]([A-Za-z0-9_.-]+\.[cm]?js):(\d+):(\d+)/g)].slice(0, 6).map((match) => `${match[1]}:${match[2]}:${match[3]}`)
    : [];
  return { type, ...(code ? { code } : {}), ...(locations.length ? { locations } : {}) };
}

export function createApplicationServer({ handler, closeResources = () => {}, logger = console, shutdownGraceMs = 10_000, onFatalError } = {}) {
  if (typeof handler !== 'function') throw new TypeError('A request handler is required.');
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1) throw new TypeError('shutdownGraceMs must be a positive integer.');

  const log = (level, event, details = {}) => {
    try { logger[level]?.(JSON.stringify({ time: new Date().toISOString(), event, ...details })); } catch { /* Logging must not interrupt a request or shutdown. */ }
  };
  const sockets = new Set();
  const drainListeners = new Set();
  let handlers = 0;
  let stopping = false;
  let shutdownPromise;
  let resourcesClosed = false;
  let started = false;
  const waitForHandlers = () => handlers === 0 ? Promise.resolve() : new Promise((resolve) => drainListeners.add(resolve));
  const closeOnce = async () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    await closeResources();
  };

  const server = createServer((req, res) => {
    const requestId = randomUUID();
    const began = performance.now();
    const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');
    let logged = false;
    const complete = () => {
      if (logged) return;
      logged = true;
      log('info', 'request_complete', { requestId, method, status: res.writableFinished ? res.statusCode : 499, durationMs: Math.round((performance.now() - began) * 10) / 10 });
      res.off('finish', complete);
      res.off('close', complete);
      if (stopping) server.closeIdleConnections();
    };
    res.once('finish', complete);
    res.once('close', complete);
    if (stopping) {
      return json(res, 503, { error: 'server_stopping', message: 'Server qayta ishga tushmoqda. Birozdan so‘ng qayta urinib ko‘ring.', requestId }, { Connection: 'close', 'Retry-After': '5' });
    }
    handlers += 1;
    Promise.resolve().then(() => handler(req, res)).catch((error) => {
      const expected = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599;
      const status = expected ? error.status : 500;
      const code = expected && /^[a-z][a-z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'internal_error';
      if (status >= 500) log('error', 'request_error', { requestId, method, status, ...safeErrorDetails(error) });
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) json(res, status, { error: code, message: expected ? error.message : 'Serverda kutilmagan xato yuz berdi.', requestId });
      else res.destroy();
    }).finally(() => {
      handlers -= 1;
      if (handlers === 0) {
        for (const resolve of drainListeners) resolve();
        drainListeners.clear();
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('error', (error) => {
    log('error', 'server_error', safeErrorDetails(error));
    if (started && !stopping) {
      shutdown('server_error').then(() => onFatalError?.(error), () => onFatalError?.(error));
    }
  });

  function shutdown(reason = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    log('info', 'shutdown_started', { reason: ['SIGINT', 'SIGTERM', 'startup_failure', 'server_error', 'shutdown'].includes(reason) ? reason : 'shutdown', graceMs: shutdownGraceMs });
    shutdownPromise = (async () => {
      let forced = false;
      let timer;
      const connectionsClosed = new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(resolve);
        server.closeIdleConnections();
      });
      try {
        await Promise.race([
          Promise.all([connectionsClosed, waitForHandlers()]),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              forced = true;
              server.closeAllConnections();
              for (const socket of sockets) socket.destroy();
              resolve();
            }, shutdownGraceMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (forced) log('warn', 'shutdown_deadline', { activeHandlers: handlers, graceMs: shutdownGraceMs });
      try {
        await closeOnce();
      } catch (error) {
        log('error', 'shutdown_failed', safeErrorDetails(error));
        throw error;
      }
      log('info', 'shutdown_complete', { forced });
      return { forced };
    })();
    return shutdownPromise;
  }

  async function listen(options) {
    if (stopping) throw new Error('Cannot listen after shutdown.');
    try {
      await new Promise((resolve, reject) => {
        const failed = (error) => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); started = true; resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        try { server.listen(options); } catch (error) { server.off('error', failed); server.off('listening', ready); reject(error); }
      });
    } catch (error) {
      await shutdown('startup_failure');
      throw error;
    }
    return server.address();
  }

  return { server, listen, shutdown };
}
