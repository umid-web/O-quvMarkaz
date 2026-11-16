import { useMemo, useState } from 'react';
import Modal from '../../components/ui/Modal';
import { markRead, notificationPath } from '../../activity/notificationStore';
import { Link } from 'react-router-dom';
import { formatStamp } from '../../activity/time';

import { isLessonNotification } from './lessonNotification';

export default function LessonNotifications({ open, onClose, items }) {
  const [group, setGroup] = useState('all');
  const [status, setStatus] = useState('all');
  const lessons = useMemo(() => items.filter(isLessonNotification), [items]);
  const groups = [...new Set(lessons.map((n) => n.entityId).filter(Boolean))].sort();
  const rows = lessons.filter((n) => (group === 'all' || n.entityId === group) && (status === 'all' || n.key.endsWith(`:${status}`)));
  return <Modal open={open} onClose={onClose} title="Dars va davomat xabarlari" subtitle="Guruhlar bo‘yicha dars natijalari va davomat nazorati" size="lg">
    <div className="lesson-notifications">
      <div className="lesson-notifications__filters">
        <label>Guruh<select className="input" value={group} onChange={(e) => setGroup(e.target.value)}><option value="all">Barcha guruhlar</option>{groups.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>Dars holati<select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Barcha holatlar</option><option value="held">Dars o‘tildi</option><option value="not_held">Dars o‘tilmadi</option><option value="missing">Davomat / tasdiq yo‘q</option></select></label>
      </div>
      <p className="lesson-notifications__count" role="status">{rows.length} ta xabar</p>
      {!rows.length && <div className="lesson-notifications__empty">Tanlangan filtrlar bo‘yicha dars xabarlari yo‘q.</div>}
      {rows.map((n) => <article key={n.id} className={`lesson-notifications__item${n.read ? '' : ' is-unread'}`}>
        <div className="lesson-notifications__meta"><strong>{n.entityId}</strong><time dateTime={n.at}>{formatStamp(n.at)}</time></div>
        <h3>{n.title}</h3><p>{n.message}</p>
        <div className="lesson-notifications__actions">{!n.read && <button type="button" className="btn btn--secondary btn--sm" onClick={() => markRead(n.id)}>O‘qildi deb belgilash</button>}<Link className="btn btn--primary btn--sm" to={notificationPath(n.link)} onClick={() => { markRead(n.id); onClose(); }}>Davomatni ochish</Link></div>
      </article>)}
    </div>
  </Modal>;
}
