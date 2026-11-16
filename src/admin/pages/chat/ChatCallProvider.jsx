import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sessionIdentity } from '../../../api/memoryStore';
import { hasBackendSession } from '../../../api/backend';
import { useChatCall } from './useChatCall';
import { ChatCallContext } from './chatCallContext';
import './ChatCallProvider.scss';

const sessionActor = () => {
  const teacherId = sessionIdentity.getItem('educontrol_teacher_id');
  const teacherType = sessionIdentity.getItem('educontrol_teacher_type') || 'main';
  const username = sessionIdentity.getItem('educontrol_username') || 'Foydalanuvchi';
  const role = sessionIdentity.getItem('educontrol_role') || '';
  return teacherId
    ? { key: `${teacherType === 'support' ? 'support' : 'teacher'}:${teacherId}`, name: username, role: 'Ustoz', teacherId }
    : { key: `user:${sessionIdentity.getItem('educontrol_user_id')}`, name: username, role, teacherId: '' };
};

function VideoTile({ stream, label, muted = false }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null; }, [stream]);
  return <div className="persistent-call__video"><video ref={ref} autoPlay playsInline muted={muted}/><span>{label}</span></div>;
}

function CallDock({ call, actor }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onChatPage = pathname.endsWith('/chat');
  if (onChatPage || (!call.roomId && !call.incoming && !call.connecting && !call.error)) return null;
  const role = sessionIdentity.getItem('educontrol_role');
  const chatPath = role === 'teacher' ? '/teacher/chat' : role === 'reception' ? '/reception/chat' : '/admin/chat';
  return <aside className="persistent-call" aria-label="Faol video aloqa">
    <header><div><strong>{call.incoming ? 'Kiruvchi video qo‘ng‘iroq' : call.connecting ? 'Ulanmoqda…' : 'Video aloqa davom etmoqda'}</strong><small>{call.incoming?.fromName || actor.name}</small></div><button type="button" onClick={() => navigate(chatPath)}>Chatga qaytish</button></header>
    {call.error && <p role="alert">{call.error}</p>}
    {(call.localStream || call.remoteStreams.length > 0) && <div className="persistent-call__videos">
      {call.localStream && <VideoTile stream={call.localStream} label={`${actor.name} (siz)`} muted/>}
      {call.remoteStreams.map(({ peerKey, stream }) => <VideoTile key={peerKey} stream={stream} label="Ishtirokchi"/>)}
    </div>}
    {call.incoming ? <div className="persistent-call__actions">
      <button type="button" className="btn btn--secondary btn--sm" onClick={call.reject}>Rad etish</button>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => { if (role === 'owner') { navigate(chatPath); return; } call.accept(); }} disabled={call.connecting}>Qabul qilish</button>
    </div> : <div className="persistent-call__actions">
      {call.roomId && <button type="button" className="icon-btn" onClick={call.toggleMute} aria-label={call.muted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish'}>{call.muted ? <MicOff size={17}/> : <Mic size={17}/>}</button>}
      {call.roomId && <button type="button" className="icon-btn" onClick={call.toggleCamera} aria-label={call.cameraOff ? 'Kamerani yoqish' : 'Kamerani o‘chirish'}>{call.cameraOff ? <VideoOff size={17}/> : <Video size={17}/>}</button>}
      <button type="button" className="btn btn--sm persistent-call__end" onClick={call.end}><PhoneOff size={15}/>{call.connecting ? 'Bekor qilish' : 'Yakunlash'}</button>
    </div>}
  </aside>;
}

function ActiveChatCallProvider({ children }) {
  const [target, setTarget] = useState(() => ({ channel: 'general', actor: sessionActor() }));
  const call = useChatCall(target.channel, target.actor);
  const configure = useCallback((channel, actor) => setTarget((current) => {
    if (current.channel === channel && current.actor.key === actor.key && current.actor.name === actor.name && current.actor.role === actor.role && current.actor.teacherId === actor.teacherId) return current;
    return { channel, actor };
  }), []);
  const value = useMemo(() => ({ ...call, configure }), [call, configure]);
  return <ChatCallContext.Provider value={value}>{children}<CallDock call={call} actor={target.actor}/></ChatCallContext.Provider>;
}

export default function ChatCallProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(hasBackendSession);
  useEffect(() => {
    const ready = () => setAuthenticated(true);
    const cleared = () => setAuthenticated(false);
    window.addEventListener('educontrol:session-ready', ready);
    window.addEventListener('educontrol:session-cleared', cleared);
    return () => {
      window.removeEventListener('educontrol:session-ready', ready);
      window.removeEventListener('educontrol:session-cleared', cleared);
    };
  }, []);
  return authenticated ? <ActiveChatCallProvider>{children}</ActiveChatCallProvider> : children;
}
