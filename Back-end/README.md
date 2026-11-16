# EduControl backend

`GET /api/auth/session` sahifa ochilganda sessiyani tekshiradi: faol hisob uchun `{ user: ... }`, sessiya yo‘q yoki yaroqsiz bo‘lsa `200 { user: null }` qaytaradi va eski cookie’ni tozalaydi. `/api/auth/me` va himoyalangan endpointlar sessiyasiz so‘rovlar uchun `401` qaytarishda davom etadi.

## Ro‘yxatlarni qidirish va sahifalash

`GET /api/records/:key` ixtiyoriy `q`, `status`, `page`, `limit` parametrlarini qabul qiladi. Masalan: `/api/records/edu-students-v1?q=Ali&status=active&page=1&limit=20`.

`q` ism-familiya, nom, telefon, email, ID, guruh va kurs kabi maydonlardan matn qidiradi (katta-kichik harf farqlanmaydi, ko‘pi bilan 300 belgi). `status` aniq tenglik bilan filtrlaydi. `page` 1 dan boshlanadi; `limit` 1–200 oralig‘ida. Sahifalash parametrlaridan biri berilsa, standart `page=1`, `limit=50` ishlatiladi va javobga `pagination: { page, limit, total, totalPages }` qo‘shiladi. Bo‘sh natijada `totalPages=0`. Sahifalash parametrlari berilmasa barcha filtrlangan yozuvlar avvalgi `{ records, version }` formatida qaytadi.

Qidiruv, filtr va jami sonlar foydalanuvchining ruxsatlari bilan cheklangan yozuvlar ustida hisoblanadi. Hozir filtrlash server xotirasida bajariladi; bu endpoint frontendga yuboriladigan javob hajmini kamaytiradi.

## Qo‘shimcha API va tekshiruvlar

Foydalanuvchi formasida to‘rtta asosiy tanlov bor: Admin, O‘qituvchi, Qo‘shimcha o‘qituvchi va Qabul xodimi. Boshqa mavjud rolning nomini yozish yoki yangi rol nomini kiritish mumkin. API orqali yangi nom uchun `roleId: ""` va `roleName: "Kutubxonachi"` yuboriladi. Rol va hisob bitta tranzaksiyada yaratiladi; nomi mavjud rolga teng bo‘lsa shu rol ishlatiladi. Yangi rol dastlab `dashboard.view`, `chat.view`, `chat.create`, `chat.edit` huquqlariga ega. Tahrirda `/api/state` dagi foydalanuvchiga `roleId: ""`, `newRoleName` yuborish mumkin; javobda yakuniy `value` va o‘zgargan kolleksiyalar `changes` maydonida keladi.

Server ishga tushganda `employee-chat-access-v1` migratsiyasi chat huquqlari umuman yo‘q eski rollarga chatni bir marta yoqadi. Oldindan qisman berilgan chat huquqlari va migratsiyadan keyin administrator kiritgan cheklovlar saqlanadi. Umumiy xabarlarni barcha chat foydalanuvchilari, shaxsiy xabarlarni esa faqat suhbat ishtirokchilari oladi. Kontaktlar ro‘yxati faol foydalanuvchi hisoblaridan tuziladi. Chat serverdagi yuboruvchini aniqlagandan keyin yozishga ruxsat beradi; yuborish xatosida matn formadan o‘chirilmaydi.

Ixtiyoriy `monthlySalary` — 0–1 000 000 000 oralig‘idagi butun son, so‘mda. Bu belgilangan oylik, amalga oshirilgan to‘lov emas. Ustozga bog‘langan hisobda maosh hali yo‘q bo‘lsa profilga qat’iy oylik sifatida birga yoziladi. Mavjud foizli, darsbay yoki qat’iy maosh bu formadan almashtirilmaydi; tegishli ustoz profilidan tahrirlanadi. Boshqa xodimlarning oyligi foydalanuvchi profilida saqlanadi.

`GET /api/payroll` — `salaries.view` huquqi bilan ish haqi ro‘yxati. Ustoz faqat o‘z qatorini oladi. Asosiy ustozlar, qo‘shimcha ustozlar va maosh belgilangan faol xodimlar bir ro‘yxatda, takrorlanmasdan qaytariladi. `edu-salary-v1` to‘lovlarida `employeeType` (`main`, `support`, `user`) va `teacherId` birga xodimni aniqlaydi. Eski yozuvlarda tur bo‘lmasa `main` deb olinadi. Darsbay oylik avvalgi hisoblash qoidasiga muvofiq haftalik darslar × 4 × dars narxi; bazaviy maosh joriy profil sozlamalari bo‘yicha olinadi, tarixiy tariflar alohida saqlanmaydi.

Foydalanuvchi yaratishda `teacherId` va `teacherType` orqali mavjud ustoz profilini bog‘lash mumkin. `teacherType` — asosiy ustoz uchun `main` (standart), qo‘shimcha ustoz uchun `support`. Ikkalasi ham `teacher` rolidan foydalanadi. Bir manbadagi bitta ustozga faqat bitta foydalanuvchi profili bog‘lanadi; bloklangan hisoblar ham band hisoblanadi. Bir xil ID ikki xil ustoz ro‘yxatida bo‘lsa manba orqali ajratiladi. `teacherId` bo‘sh bo‘lsa ism-familiya bilan qo‘lda hisob ochiladi, lekin guruhlarga kirish berilmaydi. Keyin foydalanuvchini tahrirlab profilga bog‘lash mumkin. Yangi bog‘lanishlar ishdan ketmagan ustozlarga ruxsat etiladi. Eski bog‘lanishlarda `teacherType` yo‘q bo‘lsa `main` deb olinadi.

Ustoz tanlash frontendda qidiruv va ikkita guruhlangan ro‘yxat orqali bajariladi. Foydalanuvchi tahriri, bloklash, rol almashtirish, o‘chirish va qaytarish server tasdig‘ini kutadi; saqlash rad etilsa foydalanuvchiga xato ko‘rsatiladi.

- `GET /api/records/:key/:id` — ruxsat doirasidagi bitta yozuv va kolleksiya versiyasi. Ustoz boshqa guruh yozuvini so‘rasa `404` qaytadi.
- `GET /api/dashboard?from=2026-11-01&to=2026-11-30` — ruxsat berilgan modullardagi jami/faol yozuvlar soni va moliyaviy ko‘rsatkichlar.
- `GET /api/reports/finance?from=2026-11-01&to=2026-11-30` — tushum, xarajat, farq va oylar kesimidagi natijalar. `reports.view` hamda tegishli `payments.view` / `expenses.view` huquqlari talab qilinadi. Qarzdorlik saqlangan joriy `student.debt` qiymatlari yig‘indisi; tarixiy davr qarzdorligi hisoblanmaydi. Farq tushum minus xarajat sifatida hisoblanadi; maosh xarajatlar ro‘yxatida qayd etilgan bo‘lsa shu yerda hisobga olinadi.

Sanalar `YYYY-MM-DD` formatida, chegaralar ham davrga kiradi. Davr berilmasa Toshkent vaqti bo‘yicha joriy oyning boshidan bugungacha olinadi. Moliyaviy yozuvlar `date` maydoni bo‘yicha tanlanadi. Ruxsat bo‘lmagan ko‘rsatkichlar javobga qo‘shilmaydi.

`npm run test:api` vaqtinchalik, alohida SQLite bazasida haqiqiy HTTP serverni tekshiradi. Loyiha bazasi o‘zgarmaydi. Login/logout, ruxsatlar, CRUD, noto‘g‘ri qiymatlar, versiya to‘qnashuvi, hisobot summalari, parol xeshlarining yashirilishi va ustoz davomatining guruh bo‘yicha cheklanishi tekshiriladi.

Tez boshlash (PowerShell, loyiha ildizida):

```powershell
Copy-Item Back-end/.env.example Back-end/.env
# Back-end/.env ichida BOOTSTRAP_ADMIN_PASSWORD uchun o‘zingiz parol belgilang.
npm run api
```

Ikkinchi terminalda `npm run dev` bajaring. Login: `.env` dagi `BOOTSTRAP_ADMIN_USERNAME` va `BOOTSTRAP_ADMIN_PASSWORD`. Boshlang‘ich hisob bir marta yaratiladi; keyin `.env` dagi parolni o‘zgartirish mavjud hisob parolini almashtirmaydi. Yangi hisoblar interfeys orqali yaratiladi. SQLite bazasi `Back-end/data/educontrol.sqlite` da saqlanadi.

Backend manbalari va SQLite fayllari shu papkada turadi. Server Node.js 24 yoki yangiroq versiyasini talab qiladi (`node:sqlite` ishlatiladi).

## Fayllar

- `index.js` — konfiguratsiyadan so‘ng bazani tayyorlaydi, boshlang‘ich administratorni yaratadi va HTTP serverni ishga tushiradi.
- `routes.js` — HTTP endpointlari va ularning so‘rov oqimi.
- `database.js` — SQLite ulanishi, jadvallar va indekslar.
- `dataStore.js` — list ma’lumotlarni yozuvma-yozuv `collection_records` jadvaliga saqlash, eski `app_state` yozuvlarini bir martalik ko‘chirish va versiyali holat bilan sinxron tutish. Sozlama/davomat kabi object ma’lumotlar `app_state` da qoladi.
- `security.js` — parol xeshlash, sessiyani tekshirish va cookie.
- `permissions.js` — ruxsatlar katalogi, rollar va ustoz ma’lumotlarini guruhlar bo‘yicha cheklash.
- `audit.js` — audit yozuvlari.
- `validation.js` — saqlanadigan collection formatini va yozuv ID’larini tekshiradi.
- `http.js` — JSON so‘rov/javob, cookie ajratish va xato javoblari.
- `config.js` — muhit o‘zgaruvchilari va server sozlamalari.
- `data/` — SQLite ma’lumotlar bazasi; Git’ga kiritilmaydi.

## Ishga tushirish

Loyiha ildizida `Back-end/.env.example` faylidan `Back-end/.env` yarating va boshlang‘ich admin uchun kamida 10 belgili `BOOTSTRAP_ADMIN_PASSWORD` belgilang. So‘ng ildiz papkada `npm run api` (server) va `npm run dev` (frontend) buyruqlarini alohida terminallarda bajaring.

## Frontend bilan ishlash

Frontenddagi `edu-*-v1` ma’lumotlar API orqali SQLite bazasiga sinxronlanadi va React external store xotirasida saqlanadi. Shaxsiy ma’lumotlar `localStorage`, `sessionStorage` yoki IndexedDB’ga yozilmaydi. Serverdan kelgan versiya va ruxsatlar yozishda tekshiriladi. API xatosida optimistik holat qaytariladi, RAM qoralamasi uchun qayta urinish taklif qilinadi. Yangi bazaga birinchi owner loginida standart rollar yoziladi; bo‘sh kolleksiyalar demo yozuvlari bilan to‘ldirilmaydi. Eski brauzer keshlarini tozalash va eksport qilish: [migratsiya hisoboti](../MEMORY-STORAGE-MIGRATION.md).

## Endpointlar

Frontend himoyalangan so'rovlarga server tasdiqlagan joriy hisobni `X-Educontrol-Account` sarlavhasida bog'laydi. Server autentifikatsiyani baribir HttpOnly cookie sessiyasidan oladi; ID mos kelmasa, yozish yoki logout bajarilishidan oldin `401 account_changed` qaytaradi. Bu boshqa tabda cookie hisob almashganidagi eski frontend holatini himoyalaydi. CORS preflight ushbu sarlavhaga ruxsat beradi.

`edu-settings-v1.security.sessionMinutes` API sessiyasining faolsizlik muddatini (15–480 daqiqa) belgilaydi; faol so‘rovlar sessiya cookie’si va server muddatini yangilaydi. `passwordMinLength` yangi hisob va parol almashtirishda qo‘llanadi. `twoFactor` hozircha frontenddagi DEMO sozlamasi bo‘lib, autentifikatsiyani kuchaytirmaydi.

Frontend va API turli saytlarda joylashtirilsa, `APP_ORIGINS` ga frontend originini qo‘shing va `COOKIE_SAME_SITE=None` ni faqat HTTPS ortida ishlating (`Secure` avtomatik qo‘shiladi). LAN yoki production joylashtirishda `API_HOST`, reverse proxy va `VITE_API_BASE_URL` ni moslang; `.env` qiymatlari va maxfiy kalitlarni frontend buildiga qo‘ymang.

- `GET /api/chat/sync` — chat xabarlari, onlayn holat va ishtirokchilar ro‘yxatini olish (`chat.view`).
- `POST /api/chat/presence` — brauzer oynasining onlayn holatini yangilash yoki yopilganda o‘chirish.
- `GET /api/chat/signals?channel=*&after=0`, `POST /api/chat/signals` — WebRTC takliflari, SDP va ICE signallarini qisqa muddat uzatish (`chat.view` / `chat.create`).
- `GET /api/chat/ice-config` — STUN va ixtiyoriy TURN sozlamalarini olish.

Video qo‘ng‘iroq uchun kamera/mikrofon HTTPS talab qiladi (localhost bundan mustasno). STUN standart holatda ishlaydi. Turli tarmoqlardagi NAT/firewall cheklovlarida ulanish uchun `TURN_URLS` va `TURN_SHARED_SECRET` ni sozlang; `TURN_URLS` vergul bilan ajratilgan `turn:` yoki `turns:` manzillarini qabul qiladi.

- `GET /api/health` — server holati.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password` — sessiya va hisob xavfsizligi.
- `GET /api/state`, `PUT /api/state` — frontend modullarining saqlangan holati. Har bir yozuvda versiya raqami bor; eskirgan versiya bilan yozish `409` qaytaradi.
- `GET /api/records/:key`, `POST /api/records/:key`, `PUT /api/records/:key/:id`, `DELETE /api/records/:key/:id` — ro‘yxat modullari uchun alohida CRUD endpointlari. `:key` qiymati `edu-students-v1` kabi saqlash kaliti; POST body’si `{ "record": { ... } }`, PUT body’si `{ "record": { ... }, "version": 1 }`, DELETE body’si `{ "version": 1 }` ko‘rinishida. GET versiyani ham qaytaradi; eskirgan versiya `409` qaytaradi. Foydalanuvchi va rollar hisoblar bilan birga yangilangani sabab `/api/state` orqali boshqariladi.
- `GET /api/audit` — audit tarixi.
- `POST /api/admin/accounts` — parol xeshi bilan yangi hisob ochish.

Frontend tizimga kirganda backend holatini yuklaydi, keyin o‘zgarishlarni `/api/state` ga yuboradi. Versiya to‘qnashuvida backenddan yangilangan holat olinib, mustaqil qo‘shish/tahrirlash/o‘chirishlar birlashtiriladi; bir yozuvga qilingan ziddiyatli o‘zgarish xato sifatida qaytariladi. Yangi API mijozlari `/api/records` endpointlaridan to‘g‘ridan-to‘g‘ri foydalanishi mumkin. Server ruxsatlarni tekshiradi, ma’lumot va audit hodisalarini SQLite tranzaksiyasida birga saqlaydi. Hisob yaratilganda hisob va foydalanuvchi profili ham bitta tranzaksiyada yoziladi.
