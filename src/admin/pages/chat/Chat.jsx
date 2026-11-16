import { memoryCache, sessionIdentity } from '../../../api/memoryStore.js';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, MessageCircle, MessagesSquare, Mic, MicOff, PhoneOff, Reply, Search, Send, SmilePlus, Users, Video, VideoOff, X } from 'lucide-react';
import Card from '../../components/Card';
import { Pin, PinOff, Pencil } from 'lucide-react';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import { loadTeachers } from '../teachers/teachersStore';
import { loadSupportTeachers } from '../support-teachers/supportStore';
import { loadRoles, loadUsers } from '../users-roles/usersStore';
import { usePersistentChatCall } from './usePersistentChatCall';
import { CHAT_STORAGE_KEY } from './chatStore';
import { apiRequest, syncChatBackend, updateChatPresence, saveBackendCollection, getSessionGeneration } from '../../../api/backend';
import './Chat.scss';

const PRESENCE_KEY = 'edu-chat-presence-v1';
const STICKERS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏'];
const messageDay = (value) => new Date(value).toLocaleDateString('en-CA');
const messageDayLabel = (value) => new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
const readMessages = () => {
  try {
    const parsed = JSON.parse(memoryCache.getItem(CHAT_STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const readPresence = () => {
  try { return JSON.parse(memoryCache.getItem(PRESENCE_KEY)) || {}; } catch { return {}; }
};
const lastSeenFor = (presence, key) => Math.max(0, ...Object.values(presence[key] || {}).map(Number));
const presenceLabel = (presence, key, savedLastSeen = 0) => {
  const activeSeen = lastSeenFor(presence, key);
  const lastSeen = Math.max(activeSeen, savedLastSeen);
  const stamp = lastSeen ? new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(lastSeen)) : '';
  if (activeSeen && Date.now() - activeSeen < 20000) return { online: true, text: 'Hozir online' };
  if (!lastSeen) return { online: false, text: 'Hali online bo‘lmagan' };
  return { online: false, text: `Oxirgi online: ${stamp}` };
};
const teacherForUser = (user, teachers) => teachers.find((teacher) => teacher.id === user.teacherId && teacher.teacherType === (user.teacherType || 'main'));
const actorForUser = (user, teachers, roles) => {
  const teacher = user.roleId === 'teacher' ? teacherForUser(user, teachers) : null;
  return {
    key: teacher ? `${teacher.teacherType === 'support' ? 'support' : 'teacher'}:${teacher.id}` : `user:${user.id}`,
    name: teacher ? `${teacher.firstName} ${teacher.lastName}` : `${user.firstName} ${user.lastName}`,
    role: roles.find((item) => item.id === user.roleId)?.name || user.roleId,
    teacherId: teacher?.id || '',
  };
};

function VideoTile({ stream, label, muted = false, local = false }) {
  const videoRef = useRef(null);
  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = stream || null; }, [stream]);
  return <div className="chat-video-tile"><video ref={videoRef} autoPlay playsInline muted={muted}/><span>{label}{local ? ' (siz)' : ''}</span></div>;
}

export default function Chat() {
  const users = useMemo(() => loadUsers().filter((user) => user.status === 'active'), []);
  const teachers = useMemo(() => [
    ...loadTeachers().map((teacher) => ({ ...teacher, teacherType: 'main' })),
    ...loadSupportTeachers().map((teacher) => ({ ...teacher, teacherType: 'support' })),
  ].filter((teacher) => teacher.status !== 'left'), []);
  const roles = useMemo(() => loadRoles(), []);
  const [serverActor, setServerActor] = useState(null);
  const activeRoleId = sessionIdentity.getItem('educontrol_role');
  const [ownerPermission, setOwnerPermission] = useState(null);
  const [ownerWarning, setOwnerWarning] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [permissionAction, setPermissionAction] = useState('message');
  const permissionIdentity = `${getSessionGeneration()}:${sessionIdentity.getItem('educontrol_account_id') || ''}`;
  const needsOwnerPermission = activeRoleId === 'owner' && ownerPermission !== permissionIdentity;
  const requestOwnerPermission = () => { if (needsOwnerPermission) { setPermissionAction('message'); setOwnerWarning(true); } };
  const rolePermissions = serverActor?.permissions ?? roles.find((item) => item.id === activeRoleId)?.permissions ?? [];
  const canSendChat = serverActor !== null && (activeRoleId === 'owner' || rolePermissions.includes('chat.create'));
  const canEditChat = serverActor !== null && (activeRoleId === 'owner' || rolePermissions.includes('chat.edit'));
  const [syncError, setSyncError] = useState('');
  const [serverPeers, setServerPeers] = useState(null);
  const currentUser = users.find((user) => user.id === sessionIdentity.getItem('educontrol_user_id'));
  const localActor = useMemo(() => {
    if (currentUser) return actorForUser(currentUser, teachers, roles);
    const role = sessionIdentity.getItem('educontrol_role') || 'admin';
    const username = sessionIdentity.getItem('educontrol_username') || role;
    const teacherId = sessionIdentity.getItem('educontrol_teacher_id');
    const teacher = teachers.find((item) => item.id === teacherId && item.teacherType === (sessionIdentity.getItem('educontrol_teacher_type') || 'main'));
    return teacher
      ? { key: `${teacher.teacherType === 'support' ? 'support' : 'teacher'}:${teacher.id}`, name: `${teacher.firstName} ${teacher.lastName}`, role: 'Ustoz', teacherId: teacher.id }
      : { key: `${role}:${username}`, name: username, role: roles.find((item) => item.id === role)?.name || role, teacherId: '' };
  }, [currentUser, teachers, roles]);
  const actor = serverActor ?? localActor;

  const peers = useMemo(() => {
    const list = users.filter((user) => user.roleId !== 'owner').map((user) => actorForUser(user, teachers, roles));
    const known = new Set(list.map((item) => item.key));
    teachers.forEach((teacher) => {
      const key = `${teacher.teacherType === 'support' ? 'support' : 'teacher'}:${teacher.id}`;
      if (!known.has(key)) list.push({ key, name: `${teacher.firstName} ${teacher.lastName}`, role: 'Ustoz', teacherId: teacher.id });
    });
    return list.filter((item) => item.key !== actor.key).sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [users, teachers, roles, actor]);
  const visiblePeers = useMemo(() => (serverPeers ?? peers)
    .filter((item) => item.key !== actor.key)
    .filter((item) => item.roleId !== 'owner' && !['owner', 'super admin'].includes(String(item.role || '').trim().toLowerCase()) && !users.some((user) => user.roleId === 'owner' && `user:${user.id}` === item.key))
    .sort((a, b) => a.name.localeCompare(b.name, 'uz')), [serverPeers, peers, actor.key, users]);

  const [selected, setSelected] = useState({ type: 'general', key: 'general' });
  const [messages, setMessages] = useState(readMessages);
  const [presence, setPresence] = useState(readPresence);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState('');
  const [reactionPicker, setReactionPicker] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [messageDetails, setMessageDetails] = useState(null);
  const [showPeople, setShowPeople] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const composeRef = useRef(null);
  const messagesRef = useRef(null);
  const selectedPeer = selected.type === 'direct' ? visiblePeers.find((peer) => peer.key === selected.peerKey) : null;
  const channel = selected.type === 'general'
    ? 'general'
    : `direct:${[actor.key, selected.peerKey].sort().join('|')}`;
  const visibleMessages = messages.filter((message) => message.channel === channel);
  const replyTarget = replyTo?.channel === channel ? replyTo : null;
  const detailMessage = visibleMessages.find((message) => message.id === messageDetails?.id);
  const publicReaders = (message) => (message.readBy || []).filter((key) => key !== message.fromKey && !(activeRoleId === 'owner' && key === actor.key));
  const personForKey = (key) => {
    if (key === actor.key) return { ...actor, name: `${actor.name} (siz)` };
    const peer = visiblePeers.find((person) => person.key === key);
    if (peer) return peer;
    const historical = messages.find((message) => message.fromKey === key);
    return { key, name: historical?.fromName || 'Sobiq xodim', role: historical?.fromRole || 'Xodim' };
  };
  const detailPeople = detailMessage ? messageDetails.type === 'read'
    ? [...new Set(publicReaders(detailMessage))].map((key) => ({ ...personForKey(key), emojis: [] }))
    : [...new Set(Object.values(detailMessage.reactions || {}).flat())].map((key) => ({ ...personForKey(key), emojis: Object.entries(detailMessage.reactions || {}).filter(([, voters]) => voters.includes(key)).map(([emoji]) => emoji) })) : [];
  const orderedPeers = useMemo(() => visiblePeers.map((peer) => {
    const directChannel = `direct:${[actor.key, peer.key].sort().join('|')}`;
    const latestMessage = messages.filter((message) => message.channel === directChannel).reduce((latest, message) => !latest || Date.parse(message.createdAt) > Date.parse(latest.createdAt) ? message : latest, null);
    const latest = Date.parse(latestMessage?.createdAt) || 0;
    const unread = messages.filter((message) => message.channel === directChannel && message.fromKey === peer.key && !message.readBy?.includes(actor.key)).length;
    return { ...peer, latestMessageAt: latest, preview: latestMessage ? `${latestMessage.fromKey === actor.key ? 'Siz: ' : ''}${latestMessage.text}` : peer.role, unread };
  }).sort((a, b) => b.latestMessageAt - a.latestMessageAt || a.name.localeCompare(b.name, 'uz')), [visiblePeers, messages, actor.key]);
  const filteredPeers = orderedPeers.filter((peer) => `${peer.name} ${peer.role}`.toLocaleLowerCase('uz').includes(query.trim().toLocaleLowerCase('uz')));
  const call = usePersistentChatCall(channel, actor);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const input = composeRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, Math.max(38, input.scrollHeight))}px`;
  }, [draft]);

  const selectConversation = (conversation) => {
    setSelected(conversation);
    setShowPeople(false);
    setReplyTo(null);
    setReactionPicker('');
    setMessageDetails(null);
  };

  useEffect(() => {
    const refresh = () => { setMessages(readMessages()); setPresence(readPresence()); };
    let active = true;
    let refreshing = false;
    const refreshFromServer = () => {
      if (refreshing || !active) return;
      refreshing = true;
      return syncChatBackend().then((data) => {
      if (!active) return;
      setMessages(data.messages ?? []);
      setPresence(data.presence ?? {});
      setServerPeers(data.peers ?? []);
      setServerActor(data.actor ?? null);
      setSyncError('');
      }).catch((error) => { if (active) setSyncError(error.message); })
        .finally(() => { refreshing = false; });
    };
    refreshFromServer();
    window.addEventListener('educontrol:collection', refresh);
    window.addEventListener('edu-chat-update', refresh);
    const timer = window.setInterval(refreshFromServer, 1800);
    return () => { active = false; window.removeEventListener('educontrol:collection', refresh); window.removeEventListener('edu-chat-update', refresh); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const tabId = `TAB-${Math.random().toString(36).slice(2, 10)}`;
    const generation = getSessionGeneration();
    const updatePresence = (remove = false) => {
      if (generation !== getSessionGeneration()) return;
      const all = readPresence();
      const now = Date.now();
      Object.keys(all).forEach((key) => {
        all[key] = Object.fromEntries(Object.entries(all[key] || {}).filter(([, time]) => now - Number(time) < 20000));
        if (!Object.keys(all[key]).length) delete all[key];
      });
      if (!all[actor.key]) all[actor.key] = {};
      if (remove) delete all[actor.key][tabId];
      else all[actor.key][tabId] = now;
      if (!Object.keys(all[actor.key]).length) delete all[actor.key];
      setPresence(all);
      window.dispatchEvent(new Event('edu-chat-presence'));
      updateChatPresence(tabId, remove).then(setPresence).catch(() => {});
    };
    updatePresence();
    const timer = window.setInterval(updatePresence, 5000);
    const refresh = () => setPresence(readPresence());
    const onHide = () => updatePresence(true);
    window.addEventListener('pagehide', onHide, { once: true });
    window.addEventListener('educontrol:collection', refresh);
    window.addEventListener('edu-chat-presence', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', onHide); window.removeEventListener('educontrol:collection', refresh); window.removeEventListener('edu-chat-presence', refresh); updatePresence(true); };
  }, [actor.key]);

  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [visibleMessages.length, channel]);

  useEffect(() => {
    if (!canEditChat || !pageVisible || showPeople) return;
    const all = readMessages();
    let changed = false;
    const next = all.map((message) => {
      if (message.channel !== channel || message.fromKey === actor.key || message.readBy?.includes(actor.key)) return message;
      changed = true;
      return { ...message, readBy: [...(message.readBy || []), actor.key] };
    });
    if (changed) {
      try { memoryCache.setItem(CHAT_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage to‘lib qolsa ham sahifa ishlayveradi */ }
      window.dispatchEvent(new Event('edu-chat-update'));
    }
  }, [channel, actor.key, messages, canEditChat, pageVisible, showPeople]);

  const send = async (event) => {
    event.preventDefault();
    if (!canSendChat || sending) return;
    if (needsOwnerPermission) { setOwnerWarning(true); return; }
    const text = draft.trim();
    if (!text) return;
    const next = [...readMessages(), {
      id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel,
      fromKey: actor.key,
      fromName: actor.name,
      fromRole: actor.role,
      text,
      ...(replyTarget ? { replyToId: replyTarget.id } : {}),
      createdAt: new Date().toISOString(),
      readBy: [],
    }];
    setSending(true);
    try {
      const saved = await saveBackendCollection(CHAT_STORAGE_KEY, next);
      memoryCache.setItem(CHAT_STORAGE_KEY, JSON.stringify(saved));
      setMessages(saved);
      setDraft('');
      setReplyTo(null);
      setSyncError('');
      window.dispatchEvent(new Event('edu-chat-update'));
    } catch (error) { setSyncError(error.message); }
    finally { setSending(false); }
  };

  const toggleReaction = (messageId, emoji) => {
    if (!canEditChat) return;
    const next = readMessages().map((message) => {
      if (message.id !== messageId) return message;
      const reactions = { ...(message.reactions || {}) };
      const voters = new Set(reactions[emoji] || []);
      if (voters.has(actor.key)) voters.delete(actor.key);
      else voters.add(actor.key);
      if (voters.size) reactions[emoji] = [...voters];
      else delete reactions[emoji];
      return { ...message, reactions };
    });
    try { memoryCache.setItem(CHAT_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage to‘lib qolsa ham sahifa ishlayveradi */ }
    setMessages(next);
    setReactionPicker('');
    window.dispatchEvent(new Event('edu-chat-update'));
  };

  const togglePin = async (message) => {
    if (!canEditChat || pinSaving) return;
    setPinSaving(true);
    try {
      await apiRequest('/chat/pin', { method: 'POST', body: JSON.stringify({ messageId: message.id, pinned: !message.pinned }) });
      await syncChatBackend();
      setMessages(readMessages());
    } catch (error) { setSyncError(error.message); }
    finally { setPinSaving(false); }
  };

  return <div className="chat-page">
    <Modal open={Boolean(editingMessage)} onClose={() => setEditingMessage(null)} title="Xabarni tahrirlash" footer={<><button type="button" className="btn btn--secondary" onClick={() => setEditingMessage(null)}>Bekor qilish</button><button type="button" className="btn btn--primary" disabled={!editText.trim()} onClick={async () => {
      try {
        const next = readMessages().map((m) => m.id === editingMessage.id ? { ...m, text: editText.trim(), editRevision: (m.editRevision || 0) + 1 } : m);
        setMessages(await saveBackendCollection(CHAT_STORAGE_KEY, next));
        setEditingMessage(null);
      } catch (error) { setSyncError(error.message); }
    }}>Saqlash</button></>}><textarea className="input" rows={5} value={editText} maxLength={10000} onChange={(e) => setEditText(e.target.value)} aria-label="Xabar matni" /></Modal>
    <Modal open={ownerWarning} onClose={() => setOwnerWarning(false)} title="Qoidalarni buzish haqida ogohlantirish" size="lg">
      <div className="chat-owner-warning">
        <div className="chat-owner-warning__symbol" aria-hidden="true">!</div>
        <h2>Super admin uchun {permissionAction === 'call' ? 'qo‘ng‘iroq qilish' : 'chatda yozish'} cheklangan</h2>
        <p>{permissionAction === 'call' ? 'Ruxsatsiz qo‘ng‘iroq qilish chat qoidalarini buzadi. Shunga qaramay ham qo‘ng‘iroq qilmoqchimisiz?' : 'Ruxsatsiz yozish chat qoidalarini buzadi. Shunga qaramay ham yozmoqchimisiz?'}</p>
        <div><button type="button" className="btn btn--secondary" onClick={() => setOwnerWarning(false)}>Bekor qilish</button><button type="button" className="btn btn--primary" onClick={() => { setOwnerPermission(permissionIdentity); setOwnerWarning(false); composeRef.current?.focus(); }}>Ruxsat berish</button></div>
      </div>
    </Modal>
    {syncError && <p className="field__error" role="alert">Chat bilan aloqa: {syncError}</p>}
    <Card className={`chat-shell${showPeople ? ' is-showing-people' : ''}`}>
      <aside className="chat-people">
        <div className="chat-mobile-heading"><strong>Suhbatlar</strong><button type="button" className="icon-btn" onClick={() => setShowPeople(false)} aria-label="Yozishmaga qaytish"><X size={18}/></button></div>
        <button type="button" className={`chat-people__general${selected.type === 'general' ? ' is-active' : ''}`} onClick={() => selectConversation({ type: 'general', key: 'general' })}>
          <span className="chat-people__icon"><MessagesSquare size={19}/></span><span><strong>Umumiy chat</strong><small>Barcha xodimlar</small></span>
        </button>
        <div className="chat-people__title"><span>Xodimlar</span><b>{visiblePeers.length}</b></div>
        <label className="chat-people__search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Xodim qidirish" /></label>
        <div className="chat-people__list">{filteredPeers.map((peer) => { const state = presenceLabel(presence, peer.key, peer.lastSeen); return <button type="button" key={peer.key} className={`chat-person${selected.peerKey === peer.key ? ' is-active' : ''}`} onClick={() => selectConversation({ type: 'direct', key: peer.key, peerKey: peer.key })}>
          <span className="chat-person__avatar"><Avatar firstName={peer.name.split(' ')[0]} lastName={peer.name.split(' ').slice(1).join(' ')}/><i className={state.online ? 'is-online' : ''}/></span><span><strong>{peer.name}</strong><small className="chat-person__preview">{peer.preview}</small><small className={`chat-person__presence${state.online ? ' is-online' : ''}`}>{state.text}</small></span>
          <span className="chat-person__activity">{peer.latestMessageAt > 0 && <time dateTime={new Date(peer.latestMessageAt).toISOString()} title={new Date(peer.latestMessageAt).toLocaleString('uz-UZ')}>{new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit' }).format(new Date(peer.latestMessageAt))}</time>}{peer.unread > 0 && <b className="chat-person__unread">{peer.unread}</b>}</span>
        </button>; })}{!filteredPeers.length && <p className="chat-people__empty">Xodim topilmadi</p>}</div>
      </aside>
      <section className="chat-thread">
        <header className="chat-thread__head"><button type="button" className="icon-btn chat-mobile-people" onClick={() => setShowPeople(true)} aria-label="Suhbatlarni ochish"><ArrowLeft size={21}/></button><span className="chat-people__icon">{selected.type === 'general' ? <Users size={19}/> : <MessageCircle size={19}/>}</span><div><strong>{selected.type === 'general' ? 'Umumiy chat' : selectedPeer?.name || 'Shaxsiy chat'}</strong><small>{selected.type === 'general' ? 'Barcha xodimlar bilan suhbat' : `${selectedPeer?.role || 'Xodim'} · ${presenceLabel(presence, selected.peerKey, selectedPeer?.lastSeen).text}`}</small></div><button type="button" className="btn btn--secondary btn--sm chat-thread__call" onClick={() => { if (needsOwnerPermission) { setPermissionAction('call'); setOwnerWarning(true); return; } call.start(); }} disabled={!canSendChat || call.connecting || Boolean(call.roomId)}><Video size={16}/><span>{selected.type === 'general' ? 'Video chat' : 'Video qo‘ng‘iroq'}</span></button></header>
        {call.incoming && <div className="chat-incoming"><span><Video size={18}/></span><div><strong>{call.incoming.fromName} video qo‘ng‘iroq qilyapti</strong><small>Javob berish uchun kamerani yoqing.</small></div><button type="button" className="btn btn--secondary btn--sm" onClick={call.reject}>Rad etish</button><button type="button" className="btn btn--primary btn--sm" onClick={() => { if (needsOwnerPermission) { setPermissionAction('call'); setOwnerWarning(true); return; } call.accept(); }} disabled={call.connecting || Boolean(call.roomId)}><Video size={15}/> Qabul qilish</button></div>}
        <div className="chat-pins">{visibleMessages.filter((m) => m.pinned).map((m) => <button type="button" key={m.id} className="chat-pins__item" onClick={() => document.getElementById(`chat-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Pin size={16}/><span><strong>Qadalgan xabar · {m.fromName}</strong><span>{m.text}</span></span></button>)}</div>
        {call.error && <p className="chat-call-error" role="alert">{call.error}</p>}
        {call.connecting && <div className="chat-incoming" role="status"><span>Kamera va mikrofonga ulanmoqda…</span><button type="button" className="btn btn--secondary btn--sm" onClick={call.end}>Bekor qilish</button></div>}
        {call.roomId && <div className="chat-call-stage">
          {call.localStream && <VideoTile stream={call.localStream} label={actor.name} muted local/>}
          {call.remoteStreams.map(({ peerKey, stream }) => <VideoTile key={peerKey} stream={stream} label={peers.find((peer) => peer.key === peerKey)?.name || 'Ishtirokchi'}/>)}
          <div className="chat-call-stage__controls"><button type="button" className="icon-btn" onClick={call.toggleMute} aria-label={call.muted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish'}>{call.muted ? <MicOff size={17}/> : <Mic size={17}/>}</button><button type="button" className="icon-btn" onClick={call.toggleCamera} aria-label={call.cameraOff ? 'Kamerani yoqish' : 'Kamerani o‘chirish'}>{call.cameraOff ? <VideoOff size={17}/> : <Video size={17}/>}</button><button type="button" className="btn btn--sm chat-call-end" onClick={call.end}><PhoneOff size={15}/> Yakunlash</button></div>
        </div>}
        <div className="chat-thread__messages" ref={messagesRef}>{visibleMessages.map((message, index) => {
          const mine = message.fromKey === actor.key;
          const readCount = new Set(publicReaders(message)).size;
          const directRead = selected.type === 'direct' && message.readBy?.includes(selected.peerKey);
          const reactions = Object.entries(message.reactions || {}).filter(([, voters]) => voters.length);
          const original = message.replyToId ? visibleMessages.find((item) => item.id === message.replyToId) : null;
          const newDay = index === 0 || messageDay(message.createdAt) !== messageDay(visibleMessages[index - 1].createdAt);
          return <Fragment key={message.id}>{newDay && <div className="chat-date-divider"><span>{messageDayLabel(message.createdAt)}</span></div>}<article id={`chat-${message.id}`} className={`chat-message${mine ? ' is-mine' : ''}`}>
            <div className="chat-message__meta"><strong>{mine ? 'Siz' : message.fromName}</strong><span>{new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(new Date(message.createdAt))}</span></div>
            {message.replyToId && <button type="button" className="chat-reply-quote" onClick={() => document.getElementById(`chat-${message.replyToId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} disabled={!original}><strong>{original?.fromName || 'Asl xabar mavjud emas'}</strong><span>{original?.text || 'Xabar topilmadi'}</span></button>}
            <p>{message.text}</p>
            <div className="chat-message__bottom">
              {canEditChat && message.fromKey === actor.key && <button type="button" className="chat-reply-button" title="Tahrirlash" aria-label="Xabarni tahrirlash" onClick={() => { setEditingMessage(message); setEditText(message.text); }}><Pencil size={14}/></button>}
              {message.editedAt && <small>Tahrirlangan</small>}
              {canEditChat && <button type="button" className="chat-reply-button" onClick={() => togglePin(message)} title={message.pinned ? 'Qadashdan olish' : 'Xabarni qadash'} aria-label={message.pinned ? 'Qadashdan olish' : 'Xabarni qadash'}>{message.pinned ? <PinOff size={14}/> : <Pin size={14}/>}</button>}
              {canSendChat && <button type="button" className="chat-reply-button" onClick={() => { setReplyTo(message); setReactionPicker(''); composeRef.current?.focus(); }} aria-label="Xabarga javob berish" title="Javob berish"><Reply size={14}/><span>Javob</span></button>}
              <button type="button" className={`chat-message__receipt${directRead || readCount ? ' is-read' : ''}`} onClick={() => setMessageDetails({ id: message.id, type: 'read' })} aria-label="Xabarni kimlar ko‘rganini ko‘rish"><time className="chat-message__mobile-time" dateTime={message.createdAt}>{new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>{directRead || readCount ? <CheckCheck size={14}/> : <Check size={14}/>}<span className="chat-message__receipt-label">{selected.type === 'direct' && mine ? (directRead ? 'Ko‘rildi' : 'Yuborildi') : readCount ? `${readCount} kishi ko‘rdi` : 'Hali ko‘rilmagan'}</span></button>
              <div className="chat-message__reactions">
                {reactions.map(([emoji, voters]) => <button type="button" key={emoji} className={`chat-reaction${voters.includes(actor.key) ? ' is-selected' : ''}`} onClick={() => setMessageDetails({ id: message.id, type: 'reactions' })} title={voters.map((key) => personForKey(key).name).join(', ')} aria-label={`${emoji}, ${voters.length} ta reaksiya. Kim bosganini ko‘rish`}>{emoji}<span>{voters.length}</span></button>)}
                {canEditChat && <div className="chat-sticker-picker">
                  <button type="button" className="chat-sticker-picker__toggle" onClick={() => setReactionPicker(reactionPicker === message.id ? '' : message.id)} aria-label="Stiker bilan reaksiya bildirish" aria-expanded={reactionPicker === message.id}><SmilePlus size={14}/></button>
                </div>}
              </div>
            </div>
            {reactionPicker === message.id && <div className="chat-sticker-picker__menu" role="group" aria-label="Reaksiya tanlash">{STICKERS.map((emoji) => <button type="button" key={emoji} onClick={() => toggleReaction(message.id, emoji)} aria-label={`${emoji} reaksiyasi`}>{emoji}</button>)}<button type="button" onClick={() => setReactionPicker('')} aria-label="Reaksiyalarni yopish"><X size={16}/></button></div>}
          </article></Fragment>;
        })}{!visibleMessages.length && <div className="chat-thread__empty"><span><MessageCircle size={23}/></span><strong>Hali xabar yo‘q</strong><p>Suhbatni boshlash uchun birinchi xabarni yozing.</p></div>}</div>
        <form className="chat-compose" onSubmit={send}>{replyTarget && <div className="chat-compose__reply"><Reply size={17}/><div><strong>{replyTarget.fromName} ga javob</strong><span>{replyTarget.text}</span></div><button type="button" className="chat-reply-button" onClick={() => setReplyTo(null)} aria-label="Javobni bekor qilish"><X size={17}/></button></div>}<textarea ref={composeRef} value={draft} onClick={requestOwnerPermission} onChange={(event) => { if (needsOwnerPermission) { setOwnerWarning(true); return; } setDraft(event.target.value); }} placeholder={!serverActor ? 'Chatga ulanmoqda…' : canSendChat ? `${selected.type === 'general' ? 'Umumiy chatga' : 'Xabar'} yozing...` : 'Chatda yozish huquqi yo‘q'} rows={1} disabled={!canSendChat || sending} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(event); } }} /><button type="submit" className="btn btn--primary" disabled={!canSendChat || !draft.trim() || sending} aria-label="Xabar yuborish"><Send size={17}/><span>{sending ? 'Yuborilmoqda…' : 'Yuborish'}</span></button></form>
      </section>
    </Card>
    <Modal open={Boolean(detailMessage)} onClose={() => setMessageDetails(null)} size="sm" title={messageDetails?.type === 'read' ? 'Xabarni ko‘rganlar' : 'Reaksiya bildirganlar'} subtitle={`${detailPeople.length} kishi`}>
      {detailMessage && <div className="chat-details">
        <div className="chat-details__preview"><strong>{detailMessage.fromName}</strong><p>{detailMessage.text}</p></div>
        <div className="chat-details__tabs" role="group" aria-label="Xabar tafsilotlari">
          <button type="button" className={messageDetails.type === 'reactions' ? 'is-active' : ''} onClick={() => setMessageDetails({ id: detailMessage.id, type: 'reactions' })}><SmilePlus size={15}/> Reaksiyalar</button>
          <button type="button" className={messageDetails.type === 'read' ? 'is-active' : ''} onClick={() => setMessageDetails({ id: detailMessage.id, type: 'read' })}><CheckCheck size={15}/> Ko‘rganlar</button>
        </div>
        <div className="chat-details__people">{detailPeople.map((person) => <div className="chat-details__person" key={person.key}><Avatar firstName={person.name.split(' ')[0]} lastName={person.name.split(' ').slice(1).join(' ')}/><div><strong>{person.name}</strong><small>{person.role}</small></div><span>{messageDetails.type === 'read' ? <CheckCheck size={17}/> : person.emojis.join(' ')}</span></div>)}{!detailPeople.length && <p className="chat-details__empty">{messageDetails.type === 'read' ? 'Xabarni hali hech kim ko‘rmagan.' : 'Bu xabarga hali reaksiya bildirilmagan.'}</p>}</div>
        {messageDetails.type === 'reactions' && canEditChat && <div className="chat-details__react"><small>Sizning reaksiyangiz · qayta bossangiz bekor qilinadi</small><div>{STICKERS.map((emoji) => <button type="button" key={emoji} className={`chat-reaction${detailMessage.reactions?.[emoji]?.includes(actor.key) ? ' is-selected' : ''}`} aria-pressed={Boolean(detailMessage.reactions?.[emoji]?.includes(actor.key))} aria-label={`${emoji} reaksiyasi`} onClick={() => toggleReaction(detailMessage.id, emoji)}>{emoji}</button>)}</div></div>}
      </div>}
    </Modal>
  </div>;
}


