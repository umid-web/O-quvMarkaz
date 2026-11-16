# Shaxsiy keshlarni RAM store’iga ko‘chirish

## Natija

SQLite bazasi, sxemasi va mavjud yozuvlar o‘zgartirilmadi. Backenddagi HttpOnly cookie autentifikatsiyasi va server ruxsat tekshiruvi saqlandi. Shaxsiy ma’lumotlar uchun brauzer diskiga yozish olib tashlandi.

`src/api/memoryStore.js` — har tab uchun alohida `useSyncExternalStore` bilan ishlaydigan React external store. Undagi `memoryCache` va `sessionIdentity` oddiy RAM Map’lar; ular native Storage emas. Ilova refresh bo‘lganda ular boshidan bo‘sh bo‘ladi, sessiya `/auth/session` orqali tekshiriladi, ruxsatli holat `/state` orqali qayta yuklanadi. Yuklanish, xato va qayta urinish holatlari mavjud.

## Olib tashlangan disk keshlari

Quyidagi kalitlar endi localStorage/sessionStorage’ga yozilmaydi va o‘qilmaydi; faqat bir martalik eski ma’lumotni aniqlash/tozalash oqimi ularni brauzer omboridan o‘qiydi:

```text
edu-students-v1
edu-teachers-v1
edu-support-teachers-v1
edu-courses-v1
edu-groups-v1
edu-schedule-rooms-v1
edu-attendance-v1
edu-payments-v1
edu-expenses-v1
edu-salary-v1
edu-users-v1
edu-roles-v1
edu-settings-v1
edu-notifications-v1
edu-activity-v1
edu-chat-v1
edu-chat-presence-v1
```

`educontrol_*` hisob identifikatorlari va rol ham sessionStorage’dan olib tashlanadi. JavaScript omborlariga sessiya tokeni yoki parol yozilmaydi. Amaldagi shaxs/ruxsat ma’lumotlari faqat server tasdiqlagan javobdan RAM’ga olinadi; backend cookie sessiyasini mustaqil tekshiradi.

Ilovaning localStorage’da qolgan yozuvi: **`admin-theme`** (`light`/`dark`). Boshqa ilovalarning kalitlariga tegilmaydi. Til va markazning boshqa sozlamalari API/RAM orqali olinadi. Redux persist, IndexedDB va localforage orqali qayta yozish topilmadi. Native `Storage.prototype` endi almashtirilmaydi.

## Eski saqlanmagan ishni tiklash

1. Ochilishda faqat sanalgan kalitlar alohida o‘chiriladi; `localStorage.clear()` yo‘q.
2. Eski qiymatlar vaqtincha RAM’ga olinadi, joriy ilova holatiga aralashtirilmaydi va serverga yuborilmaydi.
3. Tiklash oynasi JSON nusxani yuklab olishni taklif qiladi. Davom etish uchun foydalanuvchi nusxani olganini tasdiqlaydi yoki uni bekor qilishni ochiq tasdiqlaydi.
4. Eski navbat faqat RAM’da bo‘lgan; qaysi yozuv serverga yetganini avtomatik ishonchli ajratib bo‘lmaydi. Eksportni serverdagi holat bilan solishtirish kerak. Avtomatik import mavjud emas.
5. Nusxa olinmaguncha sahifani yopish/yangilash tavsiya etilmaydi; brauzerning beforeunload ogohlantirishi qo‘shilgan. Brauzerni majburan yopishdan RAM’ni kafolatli saqlab qolib bo‘lmaydi.
6. Brauzer eski saqlash joyini o‘qish/o‘chirishni bloklasa, xato va qayta urinish ko‘rsatiladi; tozalashni bajargandek ko‘rsatmaydi.

JSON eksportida shaxsiy/moliyaviy ma’lumotlar bo‘lishi mumkin; foydalanuvchi yuklagan faylni xavfsiz joyda saqlashi kerak.

## Saqlash, xatolik va logout

- CRUD yangilanishlari API orqali yuboriladi. Mavjud versiya nazorati va mustaqil o‘zgarishlarni birlashtirish saqlandi.
- Optimistik holat API xatosida oxirgi tasdiqlangan snapshot’ga qaytariladi. Qoralama faqat RAM’da saqlanadi; qayta yuborish yoki bekor qilish tugmalari bor.
- Muvaffaqiyat/undo toast’i mavjud yozish navbati server tomonidan tasdiqlanmaguncha ko‘rsatilmaydi.
- Bir nechta kolleksiya alohida API yozuvlari bilan saqlanadi: oldin tasdiqlangan kolleksiya keyingisi xato berganda serverda bekor qilinmaydi. Interfeys har birining oxirgi tasdiqlangan holatini ko‘rsatadi; bu yangi umumiy atomik batch API emas.
- Logout oldin navbatdagi ishni saqlaydi. Saqlash xatosi bo‘lsa logout to‘xtatiladi, qoralamani qayta yuborish/bekor qilish mumkin.
- Logout, 401 va hisob almashishi store, Context va sahifalarning shaxsiy state’larini tozalaydi. In-flight so‘rovlar abort qilinadi; kechikkan javoblar sessiya avlodi bilan rad etiladi. Chat presence va media callback’larida ham eski sessiya tekshiriladi.
- Tarmoq uzilganda logout so‘rovi serverga yetganini kafolatlab bo‘lmaydi; server sessiyasining mutlaq/faolsizlik muddati saqlanadi. Bu cheklov disk keshi mavjudligiga bog‘liq emas.

## O‘zgartirilgan fayllar

Asosiy oqim:

- `src/api/memoryStore.js` — yangi RAM store, identity, migratsiya.
- `src/api/LegacyCacheRecovery.jsx` — eski nusxani eksport qilish/ochiq bekor qilish.
- `src/api/backend.js` — API, serial navbat, server tasdig‘i, rollback/retry, abort va avlod tekshiruvi.
- `src/main.jsx`, `src/App.jsx` — boshlang‘ich tozalash, sessiya yuklash, xato/retry, state reset.
- `src/admin/components/ui/ToastProvider.jsx` — server tasdig‘idan keyingi muvaffaqiyat xabari.
- `Back-end/routes.js` — server sessiyasi bilan kutilgan hisobni solishtirish va tegishli CORS sarlavhasi.

Ma’lumot iste’molchilari va React store’lar:

- `src/admin/pages/students/useStudents.js`
- `src/admin/pages/teachers/teachersStore.js`
- `src/admin/pages/support-teachers/supportStore.js`
- `src/admin/pages/courses/coursesStore.js`
- `src/admin/pages/groups/groupsStore.js`
- `src/admin/pages/finance/{financeStore,salaryStore,Finance,Salaries}`
- `src/admin/pages/users-roles/usersStore.js`
- `src/admin/pages/users-roles/UserFormModal.jsx`
- `src/admin/pages/settings/{settingsStore,SettingsContext,Settings}`
- `src/admin/pages/attendance/Attendance.jsx`, `schedule/Schedule.jsx`, `reports/reportsUtils.js`
- `src/admin/pages/chat/{Chat,chatStore,useChatCall}`
- `src/admin/activity/{activityStore,notificationStore,systemAlerts}`
- Hisob ma’lumotlarini ko‘rsatuvchi `auth/AccountSecurity`, `auth/salaryPrivacy`, `auth/Login`, `Teacher/TeacherPages`, `Reception/*`, `admin/layout/AdminLayout`, `admin/components/{Header,Sidebar,NotificationBell}` va `admin/pages/activity/ActivityLog`.

Testlar va hujjatlar:

- `Back-end/tests/memory-store.test.js` — yangi migratsiya/lifecycle/CRUD/xatolik tekshiruvlari.
- `Back-end/tests/storage-sync.test.js`, `teacher-permissions.test.js` — RAM manbasiga moslashtirildi.
- `README.md`, `Back-end/README.md`, `PROJECT-REVIEW.md`, ushbu hisobot.

Fayl guruhlarida `.js`/`.jsx` kengaytmasi mavjud faylga qarab qo‘llanadi. Dizayn/SCSS va SQLite fayllari o‘zgartirilmadi.

## Tekshiruv natijalari

### 2026-11-11 — oxirgi tasdiqlangan tekshiruv

- `npm run verify`: muvaffaqiyatli, chiqish kodi `0`.
- Lint o'tdi; avtomatik testlar **94/94**, xatolar **0**; production build muvaffaqiyatli.
- To'liq buyruq natijasi: `verification-latest.log`.
- Haqiqiy brauzer tekshiruvi yakunlanmagan: browser access host mavjud emas, native Chrome vositasi esa joriy URL'ni ishonchli aniqlay olmagani uchun boshqarishni to'xtatdi. JSON faylni haqiqiy yuklab olish, barcha forma/modal va kamera/mikrofon oqimlari tasdiqlanmagan. Ushbu natija 100% barcha sharoitlarda ishlash kafolati emas.

### 2026-11-11 — kamera/mikrofon oqimlarining avtomatik tekshiruvi

- `Back-end/tests/chat-call.test.js`: **20 ta media ssenariysi o'tdi** (test hisobi ota test bilan 21). Testlar haqiqiy `useChatCall.js` kodini ishlatadi; React hook lifecycle, `getUserMedia`, WebRTC va tarmoq boshqariladigan test o'rinbosarlari bilan beriladi. Fizik qurilma yoki brauzer renderi ishlatilmaydi.
- Kamera va mikrofon birga so'ralishi, mikrofon/kamerani o'chirish-yoqish, boshlash/qabul qilish/rad etish/yakunlash, kiruvchi taklif bekor qilinishi, ICE candidate navbati va offer/answer tekshirildi.
- Ruxsat rad etilishi, qurilma topilmasligi yoki bandligi, xavfsizlik/rejim/abort xatolari, media yoki WebRTC API mavjud emasligi foydalanuvchiga tushunarli xabar beradi.
- Tuzatildi: takroriy bosishda parallel media so'rovlari; bekor qilish, ilova yopilishi yoki hisob almashishdan keyin kechikib kelgan stream; signal yuborish rad etilganda ochiq qoladigan qurilmalar; eski peer callback va SDP javobining yangi qo'ng'iroqqa aralashishi. Logout media treklarini darhol to'xtatadi.
- Qo'ng'iroq holati autentifikatsiyalangan ilova darajasiga ko'tarildi: Chat sahifasidan boshqa bo'limga o'tilganda media va WebRTC peer'lari saqlanadi. Boshqa sahifalarda mahalliy/masofaviy video, mikrofon/kamera boshqaruvi, Chatga qaytish va Yakunlash tugmalari bo'lgan ixcham panel ko'rinadi. Aloqa Yakunlash, qarshi tomonning `end` signali, logout yoki ilova yopilganda tugaydi.
- Interfeys ulanish jarayonini ko'rsatadi, takroriy boshlash/qabul qilishni bloklaydi va kutayotgan media so'rovini bekor qilish imkonini beradi.
- **Tasdiqlangan:** yuqoridagi dasturiy holatlar va `npm run verify` natijasi (**94/94**, lint va build o'tdi).
- **Hali tasdiqlanmagan:** fizik kameradan haqiqiy tasvir, mikrofondan haqiqiy ovoz, brauzer ruxsat oynasi, ikki qurilma orasidagi real media va NAT/TURN orqali ulanish. Avtomatik test natijasi bu amaliy sinovlar o'rnini bosmaydi; mavjud brauzer vositasi oldingi urinishda URL aniqlash cheklovi bilan to'xtagan.

Amaliy tasdiqlash uchun ikki ruxsatli hisob bilan ikki brauzer/qurilmada video qo'ng'iroq ochilib, har ikki tomonda tasvir va ovoz tekshiriladi. Mikrofon/kamera tugmalari, rad etilgan ruxsat, bo'limlar orasida o'tganda aloqaning saqlanishi hamda Yakunlash/logoutdan keyin brauzerning kamera/mikrofon indikatori o'chishi tekshiriladi. Turli tarmoqlardagi ulanish TURN sozlamasi bilan alohida sinaladi. Ushbu qo'lda bajariladigan bosqichlar hali bajarilgan deb belgilanmagan.

### 2026-11-11 — qisman migratsiya xatosidan tiklash

- Brauzer omborlaridan biri bloklanganida oldin RAM'ga olingan nusxani JSON sifatida yuklab olish ochiq qoladi. Xato va qayta urinish tugmasi nusxa bilan birga ko'rsatiladi.
- Tozalash tugamaguncha davom etish va nusxani bekor qilish tugmalari ko'rsatilmaydi. Qayta urinish qo'shimcha nusxalarni topishi mumkinligi sababli oldingi yuklab olish tasdig'i bekor qilinadi.
- `migration-recovery.test.js` qisman xatoda eksport tugmasi mavjudligini, ilovaga o'tish bloklanishini va tozalashdan keyingi tiklash oqimini React server render orqali tekshiradi.
- `npm run verify` muvaffaqiyatli: lint, barcha avtomatik testlar va production build o'tdi. Ushbu davom ettirishda haqiqiy brauzer orqali fayl yuklab olish tekshirilmadi.

### Qayta tekshiruvda yakunlangan qismlar

- Sekin yoki ustma-ust `/state` yuklashlari yangi qoralama, yangi tasdiqlangan holat va versiyani bosib yubormaydi.
- Dashboard yangilash jarayonida yangi tahrir paydo bo'lsa avtomatik sahifa reload'i bajarilmaydi; qoralamani saqlab qayta urinish talab qilinadi.
- Navbatdagi/direct yozishlar boshlang'ich versiya va snapshot'ni saqlaydi; bir paytdagi mustaqil tahrir va yangi hisob bir-birini o'chirib yubormaydi.
- `X-Educontrol-Account` server tasdiqlagan hisob ID'sini so'rovga bog'laydi. Boshqa tab cookie'ni boshqa hisobga almashtirgan bo'lsa server o'qish/yozish/logout'ni rad etadi. Sarlavha autentifikatsiya vakolati bermaydi: hisob hali HttpOnly server sessiyasidan olinadi.
- Migratsiya qisman tozalash xatosidan keyin takrorlansa, har bir manbadagi farqli qoralamalar yo'qolmaydi.
- Rad etilgan bildirishnoma/faoliyat yozuvi ko'rinadigan yolg'on RAM snapshot'ini qoldirmaydi.
- Ketma-ket tez bajarilgan collection amallari joriy RAM holatidan foydalanadi; takroriy ID va eskirgan undo yozuvlari tuzatildi. Tasdiqlangan yangi foydalanuvchi interfeysga ikki marta qo'shilmaydi.
- Sozlamalar API tasdig'ini to'g'ridan-to'g'ri kutadi; xatoda markaz sozlamasi saqlangandek ko'rsatilmaydi.
- Oldingi hisob komponentidan qolgan setter va parol-hash callback'i yangi hisob store'iga yozolmaydi.
- Qo'shimcha testlar: `hydration-races.test.js`, `migration-recovery.test.js`, `collection-actions.test.js`, `confirmed-settings.test.js`; serverdagi account-binding tekshiruvi `api.test.js` ga qo'shildi.

- `npm run test:api`: **55/55 o‘tdi**. Haqiqiy vaqtinchalik SQLite/HTTP backend testlari hamda boshqariladigan API mock’lari bilan frontend store testlari bajarildi.
- `npm run lint`: ogohlantirish va xatosiz o‘tdi.
- `npm run build`: muvaffaqiyatli.
- Login, refresh orqali qayta yuklash, create/edit/delete, API rad javobi, rollback/retry, logout, 401, hisob almashishi va eski javobni bloklash avtomatik tekshirildi.
- Static tekshiruv native disk yozuvlari faqat tema kodida qolganini hamda private storage/persist mexanizmlari qaytmaganini tekshiradi.
- Qo‘lda haqiqiy brauzer UI sinovi bajarilmadi: browser access host mavjud emas; native Chrome bilan qayta urinishda vosita joriy URL'ni ishonchli aniqlay olmagani uchun boshqarishni to'xtatdi. Kamera/mikrofon, barcha modal/formalar va haqiqiy fayl-download oqimi bu muhitda qo‘lda tasdiqlanmadi. Alohida vaqtinchalik sinov serverlari to'xtatilib, vaqtinchalik fayllari tozalandi; foydalanuvchi bazasi/tabi o'zgartirilmadi.
- Production server va foydalanuvchining mavjud brauzer keshi bilan amaliy migratsiya bajarilmadi. Tozalash yangi frontend foydalanuvchi brauzerida ochilganda ishlaydi.
