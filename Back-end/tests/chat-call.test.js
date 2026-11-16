import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'vite';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const streamFixture = () => {
  const audio = { kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true; } };
  const video = { kind: 'video', enabled: true, stopped: false, stop() { this.stopped = true; } };
  return { audio, video, getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] };
};

test('camera and microphone call lifecycle with controlled media, WebRTC and network doubles', async (t) => {
  const originals = Object.fromEntries(['window', 'navigator', 'fetch', 'RTCPeerConnection'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom',
    plugins: [{
      name: 'call-hook-lifecycle-double',
      transform(source, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/admin/pages/chat/useChatCall.js')) {
          return source.replace("from 'react'", "from '/Back-end/tests/helpers/callHookHarness.js'");
        }
      },
    }],
  });
  const { createHookHarness } = await vite.ssrLoadModule('/Back-end/tests/helpers/callHookHarness.js');
  const { useChatCall } = await vite.ssrLoadModule('/src/admin/pages/chat/useChatCall.js');
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  let harness;
  const timers = new Map();
  let stream;
  let media;
  let signals;
  let sent;
  let peers;
  let signalFailure;
  let iceFailure;
  let offer;
  const mediaCalls = [];
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  class Peer {
    constructor(config) { this.config = config; this.tracks = []; this.candidates = []; this.closed = false; peers.push(this); }
    addTrack(track) { this.tracks.push(track); }
    close() { this.closed = true; }
    async createOffer() { return offer ? offer.promise : { type: 'offer', sdp: 'test-offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'test-answer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(value) { this.candidates.push(value); }
  }
  install('window', new EventTarget());
  window.setInterval = (callback) => { const key = Symbol(); timers.set(key, callback); return key; };
  window.clearInterval = (key) => timers.delete(key);
  install('navigator', { mediaDevices: { getUserMedia: (constraints) => { mediaCalls.push(constraints); return media(); } } });
  install('RTCPeerConnection', Peer);
  install('fetch', async (path, options = {}) => {
    if (path.endsWith('/chat/ice-config')) {
      if (iceFailure) throw new Error('ICE unavailable');
      return Response.json({ iceServers: [{ urls: 'turn:test.invalid', username: 'test', credential: 'test' }] });
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (signalFailure) return Response.json({ message: 'Signal rejected' }, { status: 503 });
      return Response.json({ ok: true });
    }
    const batch = signals.splice(0);
    return Response.json({ signals: batch, cursor: batch.at(-1)?.id ?? 0 });
  });
  const user = { id: 'call-account', username: 'test', roleId: 'staff', permissions: ['chat.view', 'chat.create'] };
  const reset = async () => {
    harness?.unmount();
    api.clearBackendSession();
    timers.clear();
    stream = streamFixture(); media = async () => stream;
    signals = []; sent = []; peers = []; mediaCalls.length = 0;
    signalFailure = false; iceFailure = false; offer = null;
    install('RTCPeerConnection', Peer);
    navigator.mediaDevices = { getUserMedia: (constraints) => { mediaCalls.push(constraints); return media(); } };
    api.applySessionUser(user);
    harness = createHookHarness(useChatCall, 'general', { key: 'user:call-account' });
    harness.render();
    await setImmediate();
  };
  const view = () => harness.render();
  const deliver = async (...batch) => {
    signals.push(...batch.map((signal, index) => ({ id: index + 1, from: 'user:peer', channel: 'general', ...signal })));
    const poll = [...timers.values()][0];
    assert.ok(poll, 'mounted call has a polling timer');
    await poll();
  };
  t.after(async () => {
    harness?.unmount(); api.clearBackendSession(); await vite.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  await t.test('start acquires both tracks, mute/camera toggles work, end releases tracks', async () => {
    await reset();
    await view().start();
    assert.deepEqual(mediaCalls, [{ video: true, audio: true }]);
    assert.equal(view().localStream, stream);
    assert.match(view().roomId, /^CALL-/);
    assert.equal(sent[0].type, 'invite');
    view().toggleMute(); assert.equal(stream.audio.enabled, false); assert.equal(view().muted, true);
    view().toggleMute(); assert.equal(stream.audio.enabled, true);
    view().toggleCamera(); assert.equal(stream.video.enabled, false); assert.equal(view().cameraOff, true);
    view().toggleCamera(); assert.equal(stream.video.enabled, true);
    view().end(); await setImmediate();
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(view().localStream, null); assert.equal(view().roomId, '');
    assert.equal(view().muted, false); assert.equal(view().cameraOff, false);
    assert.equal(sent.at(-1).type, 'end');
  });

  for (const [name, message] of [
    ['NotAllowedError', /ruxsati berilmadi/], ['NotFoundError', /topilmadi/],
    ['NotReadableError', /band/], ['SecurityError', /HTTPS/],
    ['OverconstrainedError', /rejimni/], ['AbortError', /to‘xtatildi/],
  ]) await t.test(`${name} displays a useful error without starting a call`, async () => {
    await reset();
    media = async () => { throw Object.assign(new Error('device error'), { name }); };
    await view().start();
    assert.match(view().error, message);
    assert.equal(view().connecting, false); assert.equal(view().roomId, '');
    assert.equal(sent.length, 0); assert.equal(view().localStream, null);
  });

  await t.test('missing browser media or WebRTC support never activates devices', async () => {
    await reset(); navigator.mediaDevices = undefined;
    await view().start(); assert.match(view().error, /mavjud emas/);
    await reset(); install('RTCPeerConnection', undefined);
    await view().start(); assert.match(view().error, /qo‘llamaydi/);
    assert.equal(mediaCalls.length, 0);
  });

  await t.test('double start requests only one stream and cancel stops late tracks', async () => {
    await reset(); const permission = deferred(); const entered = deferred();
    media = () => { entered.resolve(); return permission.promise; };
    const start = view().start(); await entered.promise;
    assert.equal(view().connecting, true);
    await view().start(); assert.equal(mediaCalls.length, 1);
    view().end(); permission.resolve(stream); await start;
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(view().localStream, null); assert.equal(view().roomId, ''); assert.equal(sent.length, 0);
  });

  await t.test('unmount during permission prompt stops late media and sends no invite', async () => {
    await reset(); const permission = deferred(); const entered = deferred();
    media = () => { entered.resolve(); return permission.promise; };
    const start = view().start(); await entered.promise;
    harness.unmount(); permission.resolve(stream); await start;
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(sent.length, 0); assert.equal(timers.size, 0);
  });

  await t.test('logout immediately closes media and stale account callbacks cannot reopen it', async () => {
    await reset(); await view().start(); const oldStart = view().start;
    api.clearBackendSession();
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(view().roomId, '');
    api.applySessionUser({ ...user, id: 'next-account' });
    await oldStart(); assert.equal(mediaCalls.length, 1);
  });

  await t.test('leaving the chat stops devices, closes peers and sends a leave signal', async () => {
    await reset(); await view().start();
    await deliver({ type: 'join', callId: view().roomId });
    harness.unmount(); await setImmediate();
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(peers[0].closed, true); assert.equal(timers.size, 0);
    assert.equal(sent.at(-1).type, 'leave');
  });

  await t.test('session change during permission prompt stops the late stream', async () => {
    await reset(); const permission = deferred(); const entered = deferred();
    media = () => { entered.resolve(); return permission.promise; };
    const start = view().start(); await entered.promise;
    api.clearBackendSession(); api.applySessionUser({ ...user, id: 'next-account' });
    permission.resolve(stream); await start;
    assert.ok(stream.getTracks().every((track) => track.stopped)); assert.equal(sent.length, 0);
  });

  await t.test('failed invitation releases devices and allows a deliberate retry', async () => {
    await reset(); signalFailure = true;
    await view().start(); assert.match(view().error, /Signal rejected/);
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(view().roomId, ''); assert.equal(view().connecting, false);
    signalFailure = false; stream = streamFixture(); await view().start();
    assert.ok(view().roomId); assert.equal(view().localStream, stream);
  });

  await t.test('ICE config failure falls back to STUN, peers send both local tracks', async () => {
    await reset(); iceFailure = true; await view().start();
    await deliver({ type: 'join', callId: view().roomId });
    assert.deepEqual(peers[0].config.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);
    assert.deepEqual(peers[0].tracks, stream.getTracks());
    assert.equal(sent.at(-1).type, 'offer');
    const remote = streamFixture(); peers[0].ontrack({ streams: [remote] });
    assert.equal(view().remoteStreams[0].stream, remote);
    view().end(); assert.equal(peers[0].closed, true); assert.deepEqual(view().remoteStreams, []);
  });

  await t.test('incoming accept joins once and rejecting never requests device access', async () => {
    await reset(); await deliver({ type: 'invite', callId: 'CALL-incoming' });
    assert.equal(view().incoming.callId, 'CALL-incoming');
    view().reject(); await setImmediate();
    assert.equal(mediaCalls.length, 0); assert.equal(sent.at(-1).type, 'decline');
    await deliver({ type: 'invite', callId: 'CALL-accepted' });
    await view().accept();
    assert.equal(view().roomId, 'CALL-accepted'); assert.equal(view().incoming, null);
    assert.equal(sent.at(-1).type, 'join'); assert.equal(mediaCalls.length, 1);
  });

  await t.test('remote end during accept invalidates the pending permission prompt', async () => {
    await reset(); await deliver({ type: 'invite', callId: 'CALL-canceled' });
    const permission = deferred(); const entered = deferred();
    media = () => { entered.resolve(); return permission.promise; };
    const accept = view().accept(); await entered.promise;
    await deliver({ type: 'end', callId: 'CALL-canceled' });
    permission.resolve(stream); await accept;
    assert.ok(stream.getTracks().every((track) => track.stopped));
    assert.equal(view().incoming, null); assert.equal(view().roomId, ''); assert.equal(sent.length, 0);
  });

  await t.test('a canceled invitation disappears before camera access', async () => {
    await reset(); await deliver({ type: 'invite', callId: 'CALL-vanished' });
    await deliver({ type: 'end', callId: 'CALL-vanished' });
    assert.equal(view().incoming, null); await view().accept(); assert.equal(mediaCalls.length, 0);
  });

  await t.test('late peer callbacks and SDP offers cannot enter a replacement call', async () => {
    await reset(); await view().start(); offer = deferred();
    const pendingPoll = deliver({ type: 'join', callId: view().roomId });
    await setImmediate(); assert.equal(peers.length, 1);
    const lateTrack = peers[0].ontrack; const lateIce = peers[0].onicecandidate;
    view().end(); stream = streamFixture(); await view().start();
    const sentBefore = sent.length;
    lateTrack({ streams: [streamFixture()] }); lateIce({ candidate: { candidate: 'stale' } });
    offer.resolve({ type: 'offer', sdp: 'stale-offer' }); await pendingPoll;
    assert.equal(sent.length, sentBefore); assert.deepEqual(view().remoteStreams, []);
    assert.equal(peers[0].closed, true);
  });

  await t.test('candidate queue, offer/answer and remote hangup release the active call', async () => {
    await reset(); await view().start(); const callId = view().roomId;
    const candidate = { candidate: 'test-candidate' };
    await deliver({ type: 'candidate', callId, candidate });
    await deliver({ type: 'offer', callId, description: { type: 'offer', sdp: 'remote' } });
    assert.deepEqual(peers[0].candidates, [candidate]);
    assert.equal(sent.at(-1).type, 'answer');
    await deliver({ type: 'end', callId });
    assert.equal(peers[0].closed, true); assert.equal(view().localStream, null);
    assert.ok(stream.getTracks().every((track) => track.stopped));
  });
});
