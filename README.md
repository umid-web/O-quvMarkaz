# EduControl Pro — o‘quv markazini boshqarish tizimi

EduControl Pro talabalar, ustozlar, kurslar, guruhlar, dars jadvali, davomat, to‘lovlar, xarajatlar va ish haqini boshqarish uchun yaratilgan veb-ilova. Unda rollar bo‘yicha kirish, ichki chat, audio/video qo‘ng‘iroqlar, hisobotlar va faoliyat jurnali mavjud.

Ushbu README repozitoriydagi kodning 2026-11-16 holatini tushuntiradi. Imkoniyatning mavjudligi uning barcha sharoitlarda sinovdan o‘tganini anglatmaydi. Ishlamaydigan yoki tashqi xizmat talab qiladigan funksiyalar quyida alohida ko‘rsatilgan.

## Mundarija

- [Tez boshlash](#tez-boshlash)
- [Texnologiyalar va buyruqlar](#texnologiyalar-va-buyruqlar)
- [Rollar va kirish huquqlari](#rollar-va-kirish-huquqlari)
- [Modullar va imkoniyatlar](#modullar-va-imkoniyatlar)
- [Hisoblash qoidalari](#hisoblash-qoidalari)
- [Ma’lumotlarni saqlash va sinxronlash](#malumotlarni-saqlash-va-sinxronlash)
- [Bazadan zaxira nusxa olish va tiklash](#bazadan-zaxira-nusxa-olish-va-tiklash)
- [API qo‘llanmasi](#api-qollanmasi)
- [Muhit o‘zgaruvchilari](#muhit-ozgaruvchilari)
- [Xavfsizlik](#xavfsizlik)
- [Mavjud cheklovlar](#mavjud-cheklovlar)
- [Production joylashtirish](#production-joylashtirish)
- [Loyiha tuzilishi](#loyiha-tuzilishi)
- [Tekshiruvlar va nosozliklarni aniqlash](#tekshiruvlar-va-nosozliklarni-aniqlash)

## Tez boshlash

Talablar: **Node.js 24 yoki yangiroq**, npm va zamonaviy brauzer. Backend `node:sqlite` dan foydalanadi; alohida PostgreSQL/MySQL o‘rnatish talab qilinmaydi.

Loyiha ildizida, PowerShell orqali:

```powershell
npm ci
Copy-Item -LiteralPath Back-end/.env.example -Destination Back-end/.env
```

Agar `.env` allaqachon mavjud bo‘lsa, uni qayta nusxalamang. `Back-end/.env` ni oching va quyidagilarni belgilang:

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=BU_YERGA_NOYOB_KUCHLI_PAROL_YOZING
```

Namunadagi parolni ishlatmang. Boshlang‘ich parol kamida 10 belgi bo‘lishi kerak. Login 3–80 ta lotin harfi, raqam, nuqta, pastki chiziq yoki defisdan iborat bo‘ladi.

Birinchi terminal:

```powershell
npm run api
```

Ikkinchi terminal:

```powershell
npm run dev
```

Vite terminalda ko‘rsatgan manzilni oching; odatda `http://localhost:5173`. Backend odatda `http://127.0.0.1:3001` da ishlaydi. Vite `/api` so‘rovlarini shu backendga uzatadi.

1. `.env` da belgilangan login va parol bilan kiring.
2. Dastlabki owner hisob server ishga tushganda bir marta yaratiladi.
3. Owner birinchi kirganda standart rollar tayyorlanadi.
4. Kurs, guruh va ustozlarni kiriting; kerakli hisoblarni yarating.
5. Talabalarni guruhlarga qo‘shing, keyin davomat va to‘lovlarni yuriting.

**Muhim:** mavjud owner hisob uchun `.env` dagi parolni o‘zgartirish hisob parolini o‘zgartirmaydi. Buning uchun `/account/security` sahifasidan foydalaning. Eski brauzer ma’lumotlari login vaqtida bo‘sh bazaga avtomatik import qilinmaydi.

Standart baza: `Back-end/data/educontrol.sqlite`. Baza va `.env` Git’ga kiritilmaydi. Universal, kodga yozilgan tayyor login/parol yo‘q.

## Texnologiyalar va buyruqlar

| Qism | Texnologiya |
| --- | --- |
| Interfeys | React 19, React Router 7 |
| Yig‘ish va ishlab chiqish | Vite 8, React plagini |
| Uslub va belgilar | SCSS/Sass, Lucide React |
| Grafiklar | Recharts 3 |
| Backend | Node.js HTTP server, ES modullar |
| Ma’lumotlar bazasi | SQLite, `node:sqlite`, WAL |
| Autentifikatsiya | Server sessiyasi, HttpOnly cookie, scrypt |
| Qo‘ng‘iroqlar | WebRTC, STUN, ixtiyoriy TURN |
| Tekshirish | Node test runner, Oxlint |

Aniq dependency diapazonlari `package.json`, o‘rnatiladigan versiyalar `package-lock.json` da.

| Buyruq | Vazifasi |
| --- | --- |
| `npm ci` | Lock fayli bo‘yicha paketlarni o‘rnatish |
| `npm run dev` | Frontend ishlab chiqish serveri |
| `npm run api` | Backendni `.env` bilan ishga tushirish |
| `npm run api:dev` | Backendni fayllar o‘zgarganda qayta ishga tushirish |
| `npm start` | Backendni ishga tushirish; frontendni tarqatmaydi |
| `npm run build` | Frontendni `dist/` ga yig‘ish |
| `npm run preview` | Yig‘ilgan frontendni mahalliy ko‘rish |
| `npm run lint` | Oxlint tekshiruvi |
| `npm run test:api` | Backend va integratsiya testlari |
| `npm run verify` | Ketma-ket lint, API testlari va frontend build |
| `npm run db:backup -- --output <fayl.sqlite>` | SQLite bazasining tekshirilgan zaxira nusxasini yangi faylga olish |
| `npm audit` | Paketlardagi ma’lum zaifliklarni tekshirish; internet talab qiladi |

`preview` to‘liq production server o‘rnini bosmaydi. Frontend build yaratish backendni avtomatik ishga tushirmaydi.

## Rollar va kirish huquqlari

| Rol ID | Nomi | Boshlang‘ich yo‘nalishi |
| --- | --- | --- |
| `owner` | Super admin | Barcha huquqlar; egasi hisobi va roli alohida himoyalangan |
| `admin` | Administrator | Asosiy boshqaruv; foydalanuvchi va rollar standartda faqat ko‘rish uchun |
| `manager` | Menejer | O‘quv jarayoni, talabalar, guruhlar, jadval va davomat |
| `accountant` | Buxgalter | To‘lov, xarajat, ish haqi va moliyaviy hisobotlar |
| `reception` | Qabul xodimi | Talaba ro‘yxati, qabul, to‘lov va ruxsat berilgan o‘quv modullari |
| `teacher` | Ustoz | Shaxsiy guruhlar, talabalar, jadval, davomat va ish haqi |
| `custom-*` | Maxsus rol | Administrator belgilagan ruxsatlar |

Bu jadval standart shablonlarning qisqa tavsifi. Amaldagi huquqlar bazadagi rol sozlamalariga bog‘liq. Standart rollarga umumiy dashboard, chat, bildirishnoma va faoliyat ruxsatlari ham qo‘shiladi; aniq ro‘yxat `src/auth/chatPermissions.js` va `usersData.js` da.

Ruxsat shakli: `<modul>.<amal>`, masalan `students.view`, `payments.create`, `attendance.edit`. Modullar qo‘llaydigan amallar bir xil emas: ko‘rish, yaratish, tahrirlash, o‘chirish va eksport mavjudligiga qarab beriladi.

- Menyu va sahifa marshrutlari ruxsatga qarab cheklanadi.
- Backend har bir amalning ruxsatini mustaqil tekshiradi.
- Owner bo‘lmagan foydalanuvchi o‘zidan yuqori huquqli rol yoki hisobni boshqara olmaydi.
- Ishlatilayotgan va himoyalangan tizim rollarini o‘chirish cheklangan.
- Hisob paroli, roli yoki faol holati o‘zgarganda tegishli sessiyalar bekor qilinadi.
- `blocked` holatidagi hisoblar tizimga kira olmaydi. Yangi hisob parol bilan yaratiladi va darhol faol bo‘ladi.

Panel manzillari: `/admin`, `/reception`, `/teacher`. Shaxsiy parol sahifasi: `/account/security`. Administrator modul yo‘llari quyidagi jadvalda; reception va teacher panellarida ko‘pchilik modul shu nomdagi ichki yo‘l bilan ochiladi, ruxsat va ma’lumot doirasi farqlanadi.

### Ustoz hisobini bog‘lash

Hisobni asosiy yoki qo‘shimcha ustoz profiliga bog‘lash mumkin:

- `teacherType=main` — asosiy ustoz.
- `teacherType=support` — qo‘shimcha ustoz.
- Har ikkisi `teacher` rolidan foydalanadi.
- Bir manbadagi bitta ustoz profiliga bitta hisob bog‘lanadi; bloklangan hisob ham bu bog‘lanishni band qiladi.
- Profilga bog‘lanmagan ustoz hisobi avtomatik ravishda guruh ma’lumotlariga ega bo‘lmaydi.
- Standartda faqat biriktirilgan guruhlar va tegishli talabalar ko‘rinadi; aniq boshqaruv huquqlari berilsa ayrim modullarda doira kengayadi.
- Boshqa xodimlarning maoshi oddiy ko‘rish huquqi bilan ochilmaydi; server alohida maxfiylik qoidalarini qo‘llaydi.

## Modullar va imkoniyatlar

| Modul | Admin manzili | Asosiy imkoniyatlar |
| --- | --- | --- |
| Boshqaruv paneli | `/admin/dashboard` | KPI, grafiklar, o‘quv va moliyaviy ko‘rsatkichlar, bugungi jadval, tezkor amallar |
| Talabalar | `/admin/students` | Qo‘shish/tahrirlash, profil, qidiruv, holat va guruh filtrlari, saralash, sahifalash, ommaviy amallar, CSV |
| Ustozlar | `/admin/teachers` | Shaxsiy ma’lumot, fan, guruh biriktirish, holat, maosh sharti, profil va CSV |
| Qo‘shimcha ustozlar | `/admin/support-teachers` | Yordamchi, mentor, o‘rinbosar profillari; guruhlar, ish kunlari va to‘lov shartlari |
| Kurslar | `/admin/courses` | Kurs kartalari, fan, daraja, narx, davomiylik, dastur, holat va guruhlar haqida ma’lumot |
| Guruhlar | `/admin/groups` | Kurs, kod, sig‘im, dars kunlari/vaqt/xona, asosiy va qo‘shimcha ustozlar |
| Dars jadvali | `/admin/schedule` | Kunlik/haftalik vaqt chizig‘i, ustoz/xona rejimi, bandlik va kesishishlarni ko‘rsatish |
| Davomat | `/admin/attendance` | Guruh va sana bo‘yicha belgilash, keldi/kechikdi/sababli/kelmadi, oylik foiz |
| Moliya | `/admin/finance` | Tushum va xarajat xulosasi, grafiklar, moliyaviy ko‘rsatkichlar |
| To‘lovlar | `/admin/payments` | Talaba to‘lovi, sana/usul/davr, qidiruv va eksport |
| Qarzdorlik | `/admin/debts` | Joriy qarzlar va to‘lov holati bo‘yicha ko‘rish |
| Xarajatlar | `/admin/expenses` | Xarajat yozuvlari, toifa, sana, summa va eksport |
| Ish haqi | `/admin/salaries` | Asosiy/qo‘shimcha ustozlar va xodimlar; oylik, avans, bonus, jarima, to‘lov tarixi |
| Hisobotlar | `/admin/reports` | Umumiy, moliya, talabalar, davomat va guruhlar; davr tanlash, grafik, CSV va chop etish |
| Bildirishnomalar | `/admin/notifications` | Filtr, o‘qildi holati, tanlash, yashirish/o‘chirish; foydalanuvchi doirasidagi xabarlar |
| Foydalanuvchilar va rollar | `/admin/users-roles` | Hisoblar, faol/bloklangan holat, ustozga bog‘lash, maxsus rollar va ruxsatlar matritsasi |
| Sozlamalar | `/admin/settings` | Markaz rekvizitlari, tashqi ko‘rinish, moliya/davomat/bildirishnoma sozlamalari, sessiya/parol siyosati |
| Faoliyat tarixi | `/admin/activity-log` | Amallar, foydalanuvchi, vaqt, o‘zgarish tafsilotlari va filtrlar |
| Chat | `/admin/chat` | Umumiy va shaxsiy suhbatlar, javob berish, reaksiyalar, o‘qilganlik va onlayn holat, qo‘ng‘iroqlar |

CSV, ommaviy amallar va qaytarish imkoniyati tegishli sahifa va ruxsat doirasida ishlaydi; har bir modul barcha amallarni qo‘llamaydi.

### Talabalar va o‘quv jarayoni

Talaba profili ism-familiya, aloqa, guruh, qabul sanasi, holat va to‘lov ma’lumotlarini birlashtiradi. Holatlar: faol, muzlatilgan, bitirgan, ketgan. Guruh va kurs ma’lumotlari boshqa sahifalarda ham ishlatiladi.

Asosiy ustoz bitta yoki bir nechta guruhga biriktiriladi. Bitta guruhga asosiy ustoz bilan birga bir nechta qo‘shimcha ustoz biriktirish mumkin. Guruh tanlashda fan mosligi, ustoz holati, vaqt kesishishi va qo‘shimcha ustozning ish kunlari hisobga olinadi. IELTS/CEFR kabi kurslar uchun saqlangan fan metama’lumotlari qo‘llanadi.

Jadval guruhlarning kunlari, boshlanish/tugash vaqti va xonasidan olinadi. Interfeys xonada yoki ustozda vaqt kesishishini tekshiradi va mavjud ziddiyatlarni ko‘rsatadi. Bunday interfeys tekshiruvlarini to‘liq server referensial cheklovlari deb qabul qilmang.

Davomatda sana va guruh tanlanadi, talabaning to‘lov holati ko‘rinadi. Ustozning davomatni tahrirlashi `attendance.edit` ruxsatiga bog‘liq.

Davomat va dars holatini faqat guruhning belgilangan dars kunida, dars boshlanganidan tugaganidan keyingi 3 soatgacha o‘zgartirish mumkin. Vaqt Toshkent (`UTC+05:00`) bo‘yicha olinadi. Sana, dars kuni va vaqt oynasi serverda ham tekshiriladi; noto‘g‘ri kun `not_lesson_day`, yopilgan vaqt esa `attendance_closed` xatosini qaytaradi.

### Ichki chat va qo‘ng‘iroqlar

- Umumiy va ikki ishtirokchili shaxsiy kanallar.
- Matnli xabarlar, xabarga javob, reaksiyalar va o‘qiganlar holati.
- `chat.edit` ruxsati bilan ko‘rinadigan xabarni mahkamlash va mahkamlashni olib tashlash.
- Onlayn va oxirgi ko‘ringan vaqt.
- WebRTC audio/video qo‘ng‘iroqlari; kamera va mikrofonni boshqarish. Qo‘ng‘iroq vaqtida boshqa bo‘limga o‘tilsa aloqa saqlanadi va ixcham boshqaruv paneli ko‘rinadi.
- Xabarlar/presence/signallar HTTP polling orqali olinadi; WebSocket server yo‘q.
- Kamera/mikrofon uchun HTTPS yoki localhost va brauzer ruxsati kerak.
- Standart STUN ishlatiladi; murakkab NAT/firewall sharoitida TURN talab qilinishi mumkin.
- WebRTC media oqimi va SQLite’da saqlanadigan matnli chat turli mexanizmlar. Matnli chat uchun end-to-end shifrlash joriy qilinmagan.

### Sozlamalar va eksport

Markaz nomi, aloqa ma’lumotlari, ish kunlari/soati, tema, interfeys zichligi, valyuta, to‘lov usullari va boshqa sozlamalar mavjud. Yorug‘ va qorong‘i mavzu qo‘llanadi. Interfeys asosan o‘zbek tilida.

Sozlamalar JSON faylga chiqarilishi va qayta yuklanishi mumkin. **Bu butun SQLite bazasining backup/restore tizimi emas.** CSV eksportlar Excel formulasi sifatida bajarilishi mumkin bo‘lgan prefikslarni neytrallaydi; UTF-8 BOM o‘zbekcha belgilar uchun ishlatiladi.

## Hisoblash qoidalari

### Talabaning boshlang‘ich qarzi

Oyning o‘rtasida qo‘shilgan talabaga birinchi oy narxi guruh dars kunlariga qarab hisoblanadi:

```text
Birinchi oy = oylik narx × qolgan darslar / oydagi jami darslar
Boshlang‘ich qarz = birinchi oy + keyingi o‘tgan oylar × oylik narx
```

Qo‘shilgan kun hisobga kiradi. Birinchi oy summa 1 000 so‘m qadamida yaxlitlanadi. Jadval noma’lum yoki oyda dars yo‘q bo‘lsa, to‘liq oylik narx olinadi. Yangi talaba to‘lov qilmagan deb boshlanadi. Mantiq: `students/billing.js`.

To‘lov yozilganda interfeys talaba qarzini yangilaydi. Kurs narxi o‘zgarsa yangi talaba formasida yangi narx taklif qilinadi; mavjud talabalar tariflari avtomatik ravishda ommaviy almashtirilmaydi.

### Ish haqi

- Asosiy ustoz: qat’iy summa yoki faol talabalar oylik tariflari yig‘indisidan foiz.
- Foizli bazaviy ish haqi 10 000 so‘m qadamida yaxlitlanadi.
- Qo‘shimcha ustoz: qat’iy summa yoki darsbay tarif × haftalik darslar × 4.
- Boshqa faol xodimlar: profilidagi `monthlySalary`.
- Bog‘langan ustoz hisobi alohida xodim sifatida qayta hisoblanmaydi.
- To‘lov, avans, bonus va jarima yozuvlari xodim turi va oy bo‘yicha ajratiladi.

**Chegara:** foizli hisob real kassaga tushgan puldan emas, faol talabalar tarifidan olinadi. Darsbay hisob aniq kalendar oyidagi darslar emas, 4 haftalik taxmin. Eski oy uchun ham joriy profil tarifi ishlatiladi; tarixiy tariflar alohida saqlanmaydi.

### Moliyaviy hisobot

Backend to‘lov va xarajatlarni `date` maydoni bo‘yicha, chegaralarni qo‘shgan holda tanlaydi. Davr berilmasa Toshkent vaqti bo‘yicha joriy oy boshidan bugungacha olinadi.

```text
Farq = tushum − xarajat
```

Qarzdorlik joriy saqlangan `student.debt` yig‘indisi; tarixiy sanaga qarz rekonstruksiyasi emas. Ish haqi alohida xarajat sifatida qayd qilinmagan bo‘lsa moliyaviy xarajatga avtomatik kirmaydi. Ruxsatsiz ko‘rsatkichlar API javobidan chiqariladi.

## Malumotlarni saqlash va sinxronlash

Asosiy doimiy saqlash — serverdagi SQLite. Shaxsiy, moliyaviy, chat va markaz sozlamalari faqat API orqali olinib, tabga tegishli React external store xotirasida saqlanadi (`useSyncExternalStore`). Ular `localStorage`, `sessionStorage` yoki IndexedDB’ga yozilmaydi. Foydalanuvchi ID va roli ham faqat server tasdig‘idan keyin xotirada turadi; autentifikatsiya HttpOnly cookie orqali serverda tekshiriladi. `localStorage`da ilovaning faqat `admin-theme` tema tanlovi qoladi.

1. Kirishda `/api/state` orqali ruxsatli holat va versiyalar olinadi.
2. Interfeys o‘zgarishlari tegishli kolleksiyaning yozish navbatiga tushadi.
3. `/api/state` orqali qiymat va kutilgan versiya yuboriladi.
4. Eskirgan versiya `409 version_conflict` qaytaradi.
5. Mustaqil yozuvlardagi o‘zgarishlar birlashtirilishi mumkin; bitta yozuvdagi ziddiyat xato bo‘lib qoladi.
6. Optimistik yangilanish serverda rad etilsa, oxirgi tasdiqlangan holat qaytariladi. Qoralama xotirada qoladi; xato va qayta urinish/bekor qilish tugmalari ko‘rsatiladi. Muvaffaqiyat xabari server tasdig‘ini kutadi.
7. Logout, 401 yoki hisob almashishida xotira store’i, Context va shaxsiy sahifa state’lari tozalanadi. Davom etayotgan so‘rovlar abort qilinadi, eski sessiya javoblari rad etiladi. Logout oldin navbatdagi ishni saqlashga urinadi; saqlash rad etilsa qoralama foydalanuvchi qarorigacha saqlanadi.

Yozish navbati va qoralamalar faqat xotirada: bu to‘liq offline rejim emas. Saqlanmagan ish bo‘lsa sahifani yopish/yangilashda brauzer ogohlantiriladi; uni majburan yopish RAM qoralamalarini yo‘qotadi. API kutish chegarasi 15 soniya.

Yangilanishdan keyingi ochilishda quyidagi 17 eski kesh kaliti alohida o‘chiriladi; `localStorage.clear()` ishlatilmaydi. Ehtimoliy saqlanmagan eski ish uchun nusxa RAM’da ushlab turilib, JSON yuklab olish oynasi ko‘rsatiladi. Nusxa serverga avtomatik yuborilmaydi. Davom etishdan oldin uni yuklab olishni tasdiqlash yoki ochiq bekor qilish kerak. Eski queue diskda bo‘lmagani uchun qaysi yozuv yuborilmaganini avtomatik ajratib bo‘lmaydi. Tafsilotlar: [migratsiya hisoboti](MEMORY-STORAGE-MIGRATION.md).

| Kalit | Ma’lumot |
| --- | --- |
| `edu-students-v1` | Talabalar |
| `edu-teachers-v1` | Asosiy ustozlar |
| `edu-support-teachers-v1` | Qo‘shimcha ustozlar |
| `edu-courses-v1` | Kurslar |
| `edu-groups-v1` | Guruhlar |
| `edu-schedule-rooms-v1` | Xonalar |
| `edu-attendance-v1` | Davomat |
| `edu-payments-v1` | To‘lovlar |
| `edu-expenses-v1` | Xarajatlar |
| `edu-salary-v1` | Ish haqi yozuvlari |
| `edu-users-v1`, `edu-roles-v1` | Hisob profillari va rollar |
| `edu-settings-v1` | Sozlamalar |
| `edu-notifications-v1`, `edu-activity-v1` | Bildirishnoma va ilova faoliyati |
| `edu-chat-v1`, `edu-chat-presence-v1` | Chat va presence holati |

SQLite jadvallari: `accounts`, `sessions`, `app_state`, `collection_records`, `normalized_collections`, `audit_events`, `app_migrations`, `chat_call_signals`, `chat_call_participants`, `chat_presence`, `chat_last_seen`.

Ro‘yxatlar yozuvma-yozuv `collection_records` da va versiyali `app_state` bilan muvofiq saqlanadi. Sozlamalar/davomat kabi obyektlar `app_state` da qoladi. Server audit jurnali `audit_events` bo‘lib, interfeysdagi `edu-activity-v1` bilan aynan bitta manba emas.

## Bazadan zaxira nusxa olish va tiklash

Loyiha ildizida quyidagi buyruqni bajaring:

```powershell
npm run db:backup -- --output Back-end/backups/educontrol-2026-11-16.sqlite
```

Manba `Back-end/.env` dagi `SQLITE_FILE` orqali belgilanadi; standart yo‘l `Back-end/data/educontrol.sqlite`. Har bir backup uchun yangi fayl nomini tanlang. Skript mavjud chiqish faylini yoki manba bazani ustidan yozmaydi. SQLite backup API ishlatilgani uchun ishlayotgan bazadan ham nusxa olish mumkin. Nusxa `PRAGMA quick_check` bilan tekshiriladi; muvaffaqiyatda konsolga `backup_complete` va `verified: true` chiqariladi.

Backup shaxsiy va moliyaviy ma’lumotlarni o‘z ichiga oladi. Uni web-root va Git’dan tashqarida, kirishi cheklangan joyda saqlang. Skript nusxani avtomatik shifrlamaydi, tashqi omborga yubormaydi yoki reja bo‘yicha ishga tushirmaydi.

Tiklash uchun alohida CLI yo‘q. Avval backendni to‘xtating, mavjud baza hamda unga tegishli `-wal`/`-shm` fayllarini alohida saqlang. Tekshirilgan backupni bo‘sh katalogga joylab, `SQLITE_FILE` ni shu faylga yo‘naltiring va backendni qayta ishga tushiring. Eski bazaning WAL fayllarini tiklangan nusxaga aralashtirmang. Kirish, ro‘yxatlar va moliyaviy natijalarni tekshiring; tiklashni avval alohida sinov muhitida bajaring.

## API Qollanmasi

Bazaviy prefiks: `/api`. Himoyalangan so‘rovlarga sessiya cookie’si kerak. Yozish so‘rovlari `Content-Type: application/json` bilan yuboriladi. Batafsil: [Back-end/README.md](Back-end/README.md).

| Usul | Endpoint | Vazifa |
| --- | --- | --- |
| GET | `/health` | Server holati |
| POST | `/auth/login` | `{ username, password }` bilan kirish |
| POST | `/auth/logout` | Joriy sessiyani bekor qilish |
| GET | `/auth/session` | `{ user }`; sessiya bo‘lmasa `200 { user: null }` |
| GET | `/auth/me` | Joriy hisob; sessiyasiz `401` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`; token yangilanadi, eski sessiyalar bekor bo‘ladi |
| POST | `/admin/accounts` | Yangi hisob va profil yaratish |
| GET | `/state` | Ruxsatli holat, versiyalar va yozish mumkin bo‘lgan kalitlar |
| PUT | `/state` | `{ key, value, version }` bilan holatni saqlash |
| GET | `/records/:key` | Ro‘yxat, qidiruv, filtr va sahifalash |
| GET | `/records/:key/:id` | Bitta yozuv va versiya |
| POST | `/records/:key` | `{ record }` bilan yozuv qo‘shish |
| PUT | `/records/:key/:id` | `{ record, version }` bilan tahrirlash |
| DELETE | `/records/:key/:id` | `{ version }` bilan o‘chirish |
| GET | `/dashboard` | Ruxsatli jamlanma ko‘rsatkichlar |
| GET | `/reports/finance` | Moliyaviy davr hisoboti |
| GET | `/payroll` | Ruxsat doirasidagi xodimlar va bazaviy ish haqi |
| GET | `/audit?limit=100` | Server audit tarixi; limit ko‘pi bilan 200 |
| GET | `/chat/sync` | Xabarlar, presence, ishtirokchilar va joriy chat aktori |
| POST | `/chat/presence` | `{ tabId, remove? }` bilan presence yangilash |
| GET / POST | `/chat/signals` | WebRTC signal almashinuvi |
| GET | `/chat/ice-config` | STUN/TURN konfiguratsiyasi |
| POST | `/chat/pin` | `{ messageId, pinned }` bilan xabarni mahkamlash; `chat.edit` talab qilinadi |

`/records` barcha kalitlar uchun universal yozish API’si emas. Hisob va rollar `/state`/`admin/accounts` orqali; chat, bildirishnoma va faoliyatning yozilishi `/state` orqali boshqariladi. Davomat, sozlamalar, presence va xona ro‘yxati uchun ham maxsus cheklovlar bor.

Qidiruv namunasi:

```text
GET /api/records/edu-students-v1?q=Ali&status=active&page=1&limit=20
GET /api/reports/finance?from=2026-11-01&to=2026-11-30
GET /api/chat/signals?channel=*&after=0
```

`q` ko‘pi bilan 300 belgi. `page` 1 dan boshlanadi, `limit` 1–200. Sahifalash parametri bo‘lsa standart limit 50; bo‘lmasa barcha filtrlangan yozuvlar qaytadi. Javobda `records`, `version` va sahifalash yoqilganida `pagination` mavjud.

Ko‘p uchraydigan javoblar: `400` noto‘g‘ri ma’lumot, `401` sessiya yo‘q/tugagan, `403` ruxsat yoki origin rad etildi, `404` yozuv yo‘q/ko‘rinmaydi, `409` versiya yoki holat ziddiyati, `413` hajm katta, `415` media turi mos emas, `429` urinishlar ko‘p, `503` server band.

## Muhit Ozgaruvchilari

Backend `.env` fayli: `Back-end/.env`.

| O‘zgaruvchi | Standart/namuna | Izoh |
| --- | --- | --- |
| `NODE_ENV` | `development` | Productionda `production` |
| `API_HOST` | `127.0.0.1` | Tinglash manzili |
| `API_PORT` | `3001` | API porti; 0 testlarda avtomatik port uchun |
| `SQLITE_FILE` | `Back-end/data/educontrol.sqlite` | Ishchi katalogga nisbatan yoki mutlaq baza yo‘li |
| `APP_ORIGINS` | localhost 5173/5174 variantlari | Vergul bilan ajratilgan aniq ruxsatli originlar |
| `COOKIE_SAME_SITE` | `Lax` | `Strict`, `Lax`, `None`; `None` Secure cookie talab qiladi |
| `BOOTSTRAP_ADMIN_USERNAME` | `.env.example` da `admin` | Birinchi owner loginini yaratish |
| `BOOTSTRAP_ADMIN_PASSWORD` | Bo‘sh | Birinchi owner paroli; kamida 10 belgi |
| `TURN_URLS` | Bo‘sh | Vergul bilan ajratilgan `turn:`/`turns:` manzillari |
| `TURN_SHARED_SECRET` | Bo‘sh | Mos TURN serveri bilan umumiy maxfiy kalit |

Frontend uchun loyiha ildizidagi `.env.local` da ixtiyoriy:

```dotenv
VITE_API_BASE_URL=/api
```

`VITE_` qiymatlari frontend buildga kiradi. Parol, DB kaliti va TURN maxfiy kalitini bu prefiks bilan bermang. Vite API manzili o‘zgarsa frontendni qayta yig‘ing.

Productionda `APP_ORIGINS` aniq HTTPS originlardan iborat bo‘lishi shart: masalan `https://edu.example.com`. Wildcard, path yoki oxirgi `/` bilan yozmang.

## Xavfsizlik

Joriy koddagi himoyalar:

- Parollar scrypt bilan xeshlanadi; eski PBKDF2 hisoblar muvaffaqiyatli kirishda yangilanadi.
- Tasodifiy sessiya tokenining bazada faqat SHA-256 xeshi saqlanadi.
- Cookie HttpOnly va SameSite; productionda Secure.
- Sessiya faolsizlik muddati 15–480 daqiqa, standart 60; mutlaq muddat 12 soat. API so‘rovlari faollik hisoblanadi.
- Parol o‘zgarganda yangi token va barcha eski sessiyalarni bekor qilish.
- Serverda rol, ma’lumot doirasi va maosh maxfiyligi nazorati.
- Frontend so‘rovidagi kutilgan hisob ID’sini HttpOnly server sessiyasi bilan solishtirish: boshqa tab hisobni almashtirsa eski hisob tahriri yangi hisob nomidan bajarilmaydi. Bu ID autentifikatsiya vakolati bermaydi.
- Ruxsatli originlar, cross-origin yozish tekshiruvi va xavfsizlik sarlavhalari.
- IP, hisob va parallel ishlar bo‘yicha cheklovlar; autentifikatsiya crypto ishlariga ham limit.
- Login uchun IP’dan mustaqil, registrga befarq hisob limiti: 15 daqiqada 30 urinish, muvaffaqiyatli urinishlar ham hisoblanadi.
- JSON hajmi 2 MiB, nesting va qiymatlar soni chegarasi, qat’iy UTF-8, xavfli object kalitlarini rad etish.
- Parametrli SQL so‘rovlari, versiya nazorati va muhim yozishlarda tranzaksiyalar.
- Takroriy sessiya cookie’larini rad etish; sekin yuklash/crypto davomida hisob va ruxsatni qayta tekshirish.
- Chiqishda shaxsiy kesh tozalanishi va oldingi sessiya javoblarini rad etish.

Yangi hisob/parol almashtirish uchun sozlanadigan minimal uzunlik standartda 8, sozlama chegarasi 6–16 belgi. Bootstrapning kamida 10 belgili talabi bundan alohida. Uzun va noyob parollardan foydalaning.

Bu ro‘yxat 100% xavfsizlik yoki to‘liq pentest kafolati emas. Batafsil: [SECURITY-REVIEW.md](SECURITY-REVIEW.md), [PROJECT-REVIEW.md](PROJECT-REVIEW.md).

## Mavjud Cheklovlar

| Imkoniyat yoki holat | Haqiqiy holati |
| --- | --- |
| Ikki bosqichli autentifikatsiya | Joriy qilinmagan; sozlamadagi tugma nofaol |
| Yangi qurilma haqida xabar | Qurilma aniqlash va tashqi xabar xizmati ulanmagan |
| Email taklif va parolni havola bilan tiklash | Tashqi email xizmati va to‘liq oqim talab qiladi |
| SMS/Telegram/ayrim bildirishnoma sozlamalari | Demo; sozlama mavjudligi real xabar yuborilishini anglatmaydi |
| Interfeys tarjimalari | Asosan o‘zbek tili; til tanlovi to‘liq ko‘p tillilik emas |
| Sozlamalar JSON eksporti | To‘liq baza backup’i emas |
| To‘lov usuli tanlash | Bank/Click orqali real pul yechish integratsiyasi emas |
| Offline ishlash | To‘liq kafolatlangan offline navbat yo‘q |
| Kesh maxfiyligi | Shaxsiy kesh faqat har bir tab RAM’ida. Brauzer cookie’si tablar o‘rtasida umumiy; server sessiya tekshiruvi saqlanadi |
| Logout tarmoqda muvaffaqiyatsiz bo‘lsa | Mahalliy kesh tozalanadi; server sessiyasi bekor bo‘lgani tasdiqlanmaydi |
| Maosh va tarixiy qarzdorlik | Joriy tarif/qarz ishlatiladi; tarixiy holat to‘liq tiklanmaydi |
| Katta yuklama va ko‘p Node nusxalari | Umumiy rate-limit ombori va yuklama sinovi yo‘q |
| DDoS, server, backup va tiklash | Hosting infratuzilmasida alohida himoya/tekshiruv kerak |

## Production Joylashtirish

Namuna konfiguratsiya va ko‘rsatmalar: [deploy/README.md](deploy/README.md), [Nginx konfiguratsiyasi](deploy/nginx.conf.example).

1. Paketlarni lock fayli bilan o‘rnating; test, lint va build bajaring.
2. Frontendning faqat `dist/` fayllarini web-root’ga joylang.
3. Backendni alohida, root/Administrator bo‘lmagan xizmat foydalanuvchisi bilan ishga tushiring.
4. `NODE_ENV=production`, aniq HTTPS `APP_ORIGINS` va tegishli DB yo‘lini sozlang.
5. TLS reverse proxy orqali `/api` ni backendga uzating; SPA ichki yo‘llarini `index.html` ga qaytaring.
6. Backend va Vite portlarini internetga ochmang; `.env`, manba va SQLite’ni web-root’dan tashqarida saqlang.
7. DB huquqlari, shifrlangan tashqi backup, tiklash sinovi va monitoringni sozlang.
8. Audio/video kerak bo‘lsa HTTPS, kamera/mikrofon ruxsatlari va TURN bilan turli tarmoqlarda sinang.

Nginx ortida backend socket IP sifatida proxyni ko‘radi: ilova limitlari shu IP bo‘yicha umumlashadi. Namunada Nginx mijoz IP’si bo‘yicha alohida limit beradi. Ishonchsiz `X-Forwarded-For` sarlavhasiga shunchaki ishonish bilan buni almashtirmang.

Ushbu repozitoriy serverga avtomatik deploy, ishlaydigan TLS sertifikati yoki kafolatlangan backup xizmatini taqdim etmaydi.

## Loyiha Tuzilishi

```text
Back-end/
  index.js              HTTP server, bootstrap, vaqt chegaralari
  routes.js             Endpointlar va asosiy so‘rov oqimi
  config.js             Muhit qiymatlari va production tekshiruvi
  database.js           SQLite sxemasi va indekslar
  dataStore.js          Versiyali holat va yozuvli saqlash
  records.js            Ro‘yxatlar CRUD, qidiruv va sahifalash
  security.js           Parol, sessiya va cookie
  permissions.js        Rol va ma’lumot doirasi
  accessPolicy.js       Huquq oshirishni cheklash
  accountFields.js      Hisob maydonlari va rol/maosh bog‘lanishi
  teacherAccounts.js    Ustoz profili va hisob bog‘lanishi
  salaryPrivacy.js      Ish haqi maxfiyligi
  validation.js         Collection/yozuv tekshiruvi
  http.js               JSON, cookie va xatolar
  traffic.js            Trafik va parallel so‘rov cheklovi
  reports.js            Dashboard va moliyaviy hisobot API
  audit.js              Server audit yozuvlari
  migrations.js         Bir martalik ma’lumot migratsiyalari
  backup.js             SQLite backup CLI va nusxani tekshirish
  attendanceSchedule.js Davomat kuni va vaqt oynasini tekshirish
  lessonAlerts.js        Dars bildirishnomalari mantig‘i
  serverLifecycle.js    Server hayot sikli yordamchilari
  tests/                Testlar
  .env.example          Sozlama namunasi
src/
  App.jsx               Marshrutlar, sessiya va ruxsatli kirish
  main.jsx              Frontend kirish nuqtasi
  api/backend.js        API, RAM navbati, server tasdig‘i va sessiya avlodi
  api/memoryStore.js    React external store, RAM identity va eski keshni tozalash
  api/LegacyCacheRecovery.jsx  Eski qoralamalarni foydalanuvchi orqali eksport qilish
  auth/                 Login, parol va shaxsiy xavfsizlik
  Reception/            Qabul xodimi paneli
  Teacher/              Ustozning shaxsiy ko‘rinishlari
  admin/
    navigation.js       Menyu tavsifi; route’lar App.jsx da alohida
    layout/             Umumiy panel maketi
    components/         Grafik va UI komponentlar
    pages/              O‘quv, moliya va tizim modullari
    activity/           Faoliyat va bildirishnomalar mantig‘i
    data/               Dashboard hisoblari va variantlari
    utils/              Pul/sana/telefon va CSV yordamchilari
    styles/             Umumiy uslublar va tema tokenlari
public/theme-init.js     Tema boshlang‘ich yuklanishi
dist/                    Frontend build natijasi
  index.html             Build kirish sahifasi
  assets/                Hashli JavaScript va CSS fayllari
deploy/                  Nginx va systemd namunalari, deploy qo‘llanmasi
.github/                 GitHub avtomatlashtirish fayllari
vite.config.js           Vite va development API proxy
package.json             Skriptlar va dependency diapazonlari
package-lock.json        O‘rnatish uchun aniq versiyalar
```

### Yangi modul qo‘shish

Sahifa/menyudan tashqari `App.jsx` route va guard’larini, frontend hamda backend ruxsat kataloglarini, saqlash kalitini, validation, scope/privacy va yozish qoidalarini ham moslang. `navigation.js` ga element qo‘shish o‘zi backend ruxsati yoki marshrut yaratmaydi. Tegishli integratsiya testini qo‘shing.

### `dist/assets` papkasi

Bu papka `npm run build` natijasida yaratiladi. Unda `index-<hash>.js`, `index-<hash>.css`, sahifa va komponentlarning JavaScript/CSS bo‘laklari, grafik kutubxonalari hamda ikonka modullari joylashadi. Masalan, `TeacherPages-<hash>.css` ustoz sahifalarining yig‘ilgan uslublaridir. `App.jsx` dagi `lazy()` importlari sahifalarni kerak bo‘lganda yuklash imkonini beradi.

O‘zgartirishlarni `src/` ichidagi `.jsx`, `.js`, `.scss` yoki `.css` manbalarida bajaring, keyin qayta build qiling. `dist/assets` ichidagi qo‘lda qilingan tahrirlar keyingi buildda yo‘qoladi. Hashlar buildga qarab almashadi; deploy paytida mos `index.html` va barcha build fayllarini birga yangilang. `dist` backend kodi va SQLite bazasini o‘z ichiga olmaydi.

## Tekshiruvlar va Nosozliklarni Aniqlash

```powershell
npm run verify
```

Alohida tekshirish uchun `npm run lint`, `npm run test:api` va `npm run build` mavjud. Paketlar zaifligini tekshirish uchun `npm audit` ishlatiladi; u internet talab qiladi. Ushbu README yangilanishining o‘zi yangi test yoki audit natijasi hisoblanmaydi.

Testlar autentifikatsiya, ruxsatlar, ustoz doirasi, CRUD, versiya ziddiyati, hisobot, maosh, chat validatsiyasi, trafik, xavfsiz JSON, RAM store, migratsiya, API xatosida rollback va hisob almashishini qamrab oladi. Backend testlari vaqtinchalik SQLite bazalaridan foydalanadi; loyiha bazasini tahrirlamaydi. Frontend store testlarida API javoblari boshqariladigan mock bilan tekshiriladi. Bu barcha brauzer oqimlari, production yoki yuklama tekshiruvi degani emas. Joriy natijalar [migratsiya hisobotida](MEMORY-STORAGE-MIGRATION.md).

| Muammo | Tekshirish |
| --- | --- |
| Backend ochilmaydi | `node --version`; `.env` qiymatlari; owner yo‘q bo‘lsa bootstrap login/paroli |
| Serverga ulanib bo‘lmaydi | Backend terminali, API porti, Vite proxy va `VITE_API_BASE_URL` |
| Production konfiguratsiya xatosi | Aniq HTTPS `APP_ORIGINS`; wildcard, path va oxirgi slash yo‘qligi |
| Login ishlamaydi | `.env` o‘zgarishi eski parolni almashtirmaydi; hisob faolmi, urinish limiti tugaganmi |
| `401` | Sessiya muddati yoki hisob holati o‘zgargan; qayta kiring |
| `403` | Rolning modul/amal ruxsati va Origin sozlamasini tekshiring |
| `409 version_conflict` | Yangiroq holatni oling; ziddiyatli yozuvni qayta ko‘rib saqlang |
| `429` / `503` | Retry/urinish limitini kuting; proxy ostidagi umumiy IP yukini tekshiring |
| Yangi bazada ro‘yxatlar bo‘sh | Avtomatik demo import o‘chirilgan; bu kutilgan holat |
| Boshqa ustoz ma’lumoti ko‘rinmaydi | Profil bog‘lanishi, guruhlar va server scope qoidalari |
| Qo‘ng‘iroq ulanmaydi | HTTPS/localhost, brauzer ruxsati, STUN/TURN va NAT/firewall |
| `node:sqlite` ogohlantirishi | Node 24 ayrim versiyalarida eksperimental ogohlantirish chiqadi |
| Ichki URL refreshda 404 | Production web-serverda SPA fallback sozlang |

### Qo‘shimcha hujjatlar

- [Backend qo‘llanmasi](Back-end/README.md)
- [Joylashtirish qo‘llanmasi](deploy/README.md)
- [Xavfsizlik tekshiruvi](SECURITY-REVIEW.md)
- [Loyiha kamchiliklari va tuzatishlar](PROJECT-REVIEW.md)
- [RAM saqlashga o‘tish hisoboti](MEMORY-STORAGE-MIGRATION.md)
- [Brauzer tekshiruvi — 2026-11-16](BROWSER-VERIFICATION-2026-11-16.md)
- [Xavfsizlik tekshiruvi — 2026-11-13](SECURITY-VERIFICATION-2026-11-13.md)

## Litsenziya

`package.json` loyihani `private: true` deb belgilaydi. Repozitoriy ildizida alohida `LICENSE` fayli mavjud emas; foydalanish va tarqatish shartlari loyiha egasi bilan belgilanadi.
