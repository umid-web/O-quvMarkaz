import { useState } from 'react';
import { getLegacyRecovery, discardLegacyRecovery, getMigrationError, migratePrivateCaches } from './memoryStore.js';

export default function LegacyCacheRecovery({ children }) {
  const [recovery, setRecovery] = useState(getLegacyRecovery);
  const [downloaded, setDownloaded] = useState(false);
  const [migrationError, setMigrationError] = useState(getMigrationError);
  const retryMigration = () => {
    migratePrivateCaches();
    setMigrationError(getMigrationError());
    setRecovery(getLegacyRecovery());
    // A retry can recover additional drafts; the previous export may be incomplete.
    setDownloaded(false);
  };
  const errorPanel = migrationError && <section role="alert"><p>{migrationError}</p><button className="btn btn--primary" onClick={retryMigration}>Qayta urinish</button></section>;
  if (!recovery) return migrationError ? <main className="page-loading">{errorPanel}</main> : children;
  const exportDrafts = () => {
    const collections = Object.fromEntries(Object.entries(recovery).map(([key, raw]) => {
      try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'legacy-cache-recovery', exportedAt: new Date().toISOString(), collections }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'educontrol-old-cache-recovery.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setDownloaded(true);
  };
  const finish = () => { discardLegacyRecovery(); setRecovery(null); };
  return <main className="page-loading">{errorPanel}<section aria-labelledby="cache-migration-title">
    <h1 id="cache-migration-title">Eski brauzer keshini saqlab olish</h1>
    <p>{Object.keys(recovery).length} ta eski kesh nusxasi vaqtincha shu sahifa xotirasida turibdi; serverga yuborilmadi. {migrationError ? 'Brauzerdagi keshni tozalash hali tugamadi. Hozir mavjud nusxani yuklab olishingiz mumkin; qayta urinishdan keyin uni yangidan yuklab oling.' : 'Brauzerdagi eski kesh tozalandi.'}</p>
    <p>Eski navbat faqat xotirada bo‘lgan. Qaysi o‘zgarishlar serverga yetmaganini aniq ajratib bo‘lmaydi. Ish yo‘qolmasligi uchun JSON nusxani yuklab oling va serverdagi yozuvlar bilan solishtiring. Faylda shaxsiy va moliyaviy ma’lumotlar bo‘lishi mumkin.</p>
    <p>Nusxa olinmaguncha sahifani yopmang yoki yangilamang. Yuklangan fayl serverga avtomatik import qilinmaydi.</p>
    <button className="btn btn--primary" onClick={exportDrafts}>JSON nusxani yuklab olish</button>
    {downloaded && !migrationError && <button className="btn btn--secondary" onClick={finish}>Nusxani oldim, davom etish</button>}
    {!migrationError && <button className="btn btn--secondary" onClick={() => { if (window.confirm('Eski kesh nusxasini olmasdan o‘chirasizmi? Saqlanmagan ishni tiklab bo‘lmaydi.')) finish(); }}>Eski nusxani bekor qilish</button>}
  </section></main>;
}
