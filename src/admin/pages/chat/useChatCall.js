import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, getSessionGeneration, hasBackendSession } from '../../../api/backend';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MEDIA_ERRORS = {
  NotAllowedError: 'Kamera yoki mikrofon ruxsati berilmadi. Brauzerdagi sayt ruxsatlarini tekshiring.',
  SecurityError: 'Brauzer kamera va mikrofonni blokladi. HTTPS yoki localhost orqali oching.',
  NotFoundError: 'Kamera yoki mikrofon topilmadi. Qurilmalarni ulang va qayta urinib ko‘ring.',
  NotReadableError: 'Kamera yoki mikrofonni ochib bo‘lmadi. Qurilma boshqa ilovada band bo‘lishi mumkin.',
  OverconstrainedError: 'Kamera yoki mikrofon talab qilingan rejimni qo‘llamaydi.',
  AbortError: 'Kamera va mikrofonni ochish to‘xtatildi. Qayta urinib ko‘ring.',
};

export function useChatCall(channel, actor) {
  const sessionGeneration = useRef(getSessionGeneration());
  const [roomId, setRoomId] = useState('');
  const [incoming, setIncoming] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const connectingRef = useRef(false);
  const acceptingRef = useRef('');
  const roomRef = useRef('');
  const localRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const channelRef = useRef(channel);
  const callChannelRef = useRef(channel);
  const actorRef = useRef(actor);
  useEffect(() => {
    actorRef.current = actor;
    channelRef.current = channel;
  }, [actor, channel]);

  const isCurrent = useCallback((operation = operationRef.current) => mountedRef.current && operation === operationRef.current && hasBackendSession() && sessionGeneration.current === getSessionGeneration(), []);
  const broadcast = useCallback(async (payload) => {
    if (!isCurrent()) return;
    await apiRequest('/chat/signals', {
      method: 'POST',
      body: JSON.stringify({ channel: payload.channel || callChannelRef.current || channelRef.current, ...payload }),
    });
  }, [isCurrent]);
  const updateRoom = useCallback((value) => { roomRef.current = value; setRoomId(value); }, []);
  const getMedia = useCallback(async (operation) => {
    if (!isCurrent(operation)) throw new Error('Sessiya o‘zgardi.');
    if (localRef.current) return localRef.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu brauzarda kamera va mikrofon mavjud emas.');
    if (typeof RTCPeerConnection === 'undefined') throw new Error('Bu brauzer video qo‘ng‘iroqni qo‘llamaydi.');
    try {
      const config = await apiRequest('/chat/ice-config');
      if (Array.isArray(config.iceServers) && config.iceServers.length) iceServersRef.current = config.iceServers;
    } catch { /* STUN fallback still supports direct peer connections. */ }
    if (!isCurrent(operation)) throw new Error('Sessiya o‘zgardi.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
    catch (cause) { throw new Error(MEDIA_ERRORS[cause.name] || 'Kamera va mikrofonni yoqib bo‘lmadi. Qayta urinib ko‘ring.'); }
    if (!isCurrent(operation)) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Sessiya o‘zgardi.');
    }
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, [isCurrent]);

  const clearPeer = useCallback((peerKey) => {
    const peer = peersRef.current.get(peerKey);
    if (peer) {
      peer.ontrack = peer.onicecandidate = peer.onconnectionstatechange = null;
      peer.close();
    }
    peersRef.current.delete(peerKey);
    pendingRef.current.delete(peerKey);
    setRemoteStreams((list) => list.filter((item) => item.peerKey !== peerKey));
  }, []);

  const closeRoom = useCallback(() => {
    operationRef.current += 1;
    connectingRef.current = false;
    acceptingRef.current = '';
    setConnecting(false);
    peersRef.current.forEach((peer) => {
      peer.ontrack = peer.onicecandidate = peer.onconnectionstatechange = null;
      peer.close();
    });
    peersRef.current.clear();
    pendingRef.current.clear();
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    setLocalStream(null);
    setRemoteStreams([]);
    setIncoming(null);
    setError('');
    setMuted(false);
    setCameraOff(false);
    updateRoom('');
  }, [updateRoom]);

  const makePeer = useCallback((peerKey) => {
    if (peersRef.current.has(peerKey)) return peersRef.current.get(peerKey);
    const connection = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const operation = operationRef.current;
    const callId = roomRef.current;
    const valid = () => isCurrent(operation) && roomRef.current === callId && peersRef.current.get(peerKey) === connection;
    peersRef.current.set(peerKey, connection);
    localRef.current?.getTracks().forEach((track) => connection.addTrack(track, localRef.current));
    connection.ontrack = (event) => {
      if (!valid()) return;
      const stream = event.streams[0];
      if (stream) setRemoteStreams((list) => [...list.filter((item) => item.peerKey !== peerKey), { peerKey, stream }]);
    };
    connection.onicecandidate = (event) => {
      if (valid() && event.candidate) void broadcast({ type: 'candidate', callId, to: peerKey, candidate: event.candidate }).catch(() => {
        if (valid()) setError('Qo‘ng‘iroq signali serverga yuborilmadi. Tarmoqni tekshirib qayta urinib ko‘ring.');
      });
    };
    connection.onconnectionstatechange = () => {
      if (valid() && ['failed', 'closed', 'disconnected'].includes(connection.connectionState)) clearPeer(peerKey);
    };
    return connection;
  }, [broadcast, clearPeer, isCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let polling = false;
    let after = 0;
    const receive = async (data) => {
      if (!active || !isCurrent() || !data || data.from === actorRef.current.key || (data.to && data.to !== actorRef.current.key)) return;
      if (data.type === 'invite') {
        if (!roomRef.current) setIncoming(data);
        return;
      }
      if (data.type === 'end') {
        setIncoming((current) => current?.callId === data.callId ? null : current);
        if (data.callId === roomRef.current || data.callId === acceptingRef.current) closeRoom();
        return;
      }
      if (data.type === 'leave' && data.callId === roomRef.current) { clearPeer(data.from); return; }
      if (data.type === 'decline' && data.callId === roomRef.current) { clearPeer(data.from); return; }
      if (data.callId !== roomRef.current || data.channel !== callChannelRef.current) return;
      const operation = operationRef.current;
      let connection;
      const valid = () => active && isCurrent(operation) && roomRef.current === data.callId && (!connection || peersRef.current.get(data.from) === connection);
      try {
        if (data.type === 'join') {
          connection = makePeer(data.from);
          const offer = await connection.createOffer();
          if (!valid()) return;
          await connection.setLocalDescription(offer);
          if (!valid()) return;
          await broadcast({ type: 'offer', callId: data.callId, to: data.from, description: connection.localDescription });
        } else if (data.type === 'offer') {
          connection = makePeer(data.from);
          await connection.setRemoteDescription(data.description);
          if (!valid()) return;
          const queued = pendingRef.current.get(data.from) || [];
          for (const candidate of queued) { if (!valid()) return; await connection.addIceCandidate(candidate); }
          pendingRef.current.delete(data.from);
          const answer = await connection.createAnswer();
          if (!valid()) return;
          await connection.setLocalDescription(answer);
          if (!valid()) return;
          await broadcast({ type: 'answer', callId: data.callId, to: data.from, description: connection.localDescription });
        } else if (data.type === 'answer') {
          connection = peersRef.current.get(data.from);
          if (!connection || connection.remoteDescription) return;
          await connection.setRemoteDescription(data.description);
          if (!valid()) return;
          const queued = pendingRef.current.get(data.from) || [];
          for (const candidate of queued) { if (!valid()) return; await connection.addIceCandidate(candidate); }
          pendingRef.current.delete(data.from);
        } else if (data.type === 'candidate') {
          const connection = peersRef.current.get(data.from);
          if (connection?.remoteDescription) await connection.addIceCandidate(data.candidate);
          else pendingRef.current.set(data.from, [...(pendingRef.current.get(data.from) || []), data.candidate]);
        }
      } catch { if (valid()) setError('Video ulanishida xatolik yuz berdi. Qayta urinib ko‘ring.'); }
    };
    const poll = async () => {
      if (polling || !active || !isCurrent()) return;
      polling = true;
      try {
        const params = new URLSearchParams({ channel: '*', after: String(after) });
        const { signals = [], cursor = after } = await apiRequest(`/chat/signals?${params}`);
        if (!active || !isCurrent()) return;
        for (const signal of signals) {
          after = Math.max(after, signal.id);
          await receive(signal);
        }
        after = Math.max(after, cursor);
      } catch { /* Chat state sync reports general connection errors. */ }
      finally { polling = false; }
    };
    poll();
    const timer = window.setInterval(poll, 700);
    window.addEventListener('educontrol:session-cleared', closeRoom);
    return () => {
      if (roomRef.current && isCurrent()) void broadcast({ type: 'leave', callId: roomRef.current }).catch(() => {});
      active = false;
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('educontrol:session-cleared', closeRoom);
      closeRoom();
    };
  }, [broadcast, clearPeer, closeRoom, makePeer, isCurrent]);

  const start = useCallback(async () => {
    if (!isCurrent() || connectingRef.current || roomRef.current) return;
    const operation = ++operationRef.current;
    connectingRef.current = true;
    setConnecting(true);
    try {
      setError('');
      await getMedia(operation);
      if (!isCurrent(operation)) return;
      const id = `CALL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      callChannelRef.current = channelRef.current;
      updateRoom(id);
      await broadcast({ type: 'invite', callId: id, channel: callChannelRef.current });
    } catch (cause) {
      if (isCurrent(operation)) { closeRoom(); setError(cause.message || 'Kamera va mikrofonni yoqib bo‘lmadi.'); }
    } finally {
      if (isCurrent(operation)) { connectingRef.current = false; setConnecting(false); }
    }
  }, [broadcast, getMedia, updateRoom, isCurrent, closeRoom]);

  const accept = useCallback(async () => {
    if (!incoming || !isCurrent() || connectingRef.current || roomRef.current) return;
    const operation = ++operationRef.current;
    acceptingRef.current = incoming.callId;
    connectingRef.current = true;
    setConnecting(true);
    try {
      setError('');
      await getMedia(operation);
      if (!isCurrent(operation)) return;
      callChannelRef.current = incoming.channel;
      updateRoom(incoming.callId);
      await broadcast({ type: 'join', callId: incoming.callId, to: incoming.from });
      if (!isCurrent(operation)) return;
      setIncoming(null);
    } catch (cause) {
      if (isCurrent(operation)) { closeRoom(); setError(cause.message || 'Kamera va mikrofonni yoqib bo‘lmadi.'); }
    } finally {
      if (isCurrent(operation)) { connectingRef.current = false; acceptingRef.current = ''; setConnecting(false); }
    }
  }, [broadcast, getMedia, incoming, updateRoom, isCurrent, closeRoom]);

  const reject = useCallback(() => {
    const operation = operationRef.current;
    if (incoming) void broadcast({ type: 'decline', channel: incoming.channel, callId: incoming.callId, to: incoming.from }).catch(() => {
      if (isCurrent(operation)) setError('Qo‘ng‘iroqni rad etish serverga yuborilmadi.');
    });
    setIncoming(null);
    if (acceptingRef.current) closeRoom();
  }, [broadcast, incoming, closeRoom, isCurrent]);

  const end = useCallback(() => {
    const request = roomRef.current ? broadcast({ type: 'end', callId: roomRef.current }) : null;
    closeRoom();
    const operation = operationRef.current;
    request?.catch(() => { if (isCurrent(operation)) setError('Qo‘ng‘iroq tugadi, ammo serverga xabar yuborilmadi.'); });
  }, [broadcast, closeRoom, isCurrent]);

  const toggleMute = () => { const next = !muted; localRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); };
  const toggleCamera = () => { const next = !cameraOff; localRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; }); setCameraOff(next); };

  return { roomId, incoming, localStream, remoteStreams, error, muted, cameraOff, connecting, start, accept, reject, end, toggleMute, toggleCamera };
}
