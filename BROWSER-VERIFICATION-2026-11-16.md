# Brauzer funksional tekshiruvi — 2026-11-16

## Natija

- Mahalliy Google Chrome, headless rejim va DevTools Protocol orqali bajarilgan 34/34 funksional sinov muvaffaqiyatli.
- `npm run verify`: lint, 104/104 avtomatik test va production build muvaffaqiyatli.
- Chrome konsoli va bajarilmagan JavaScript istisnolarini kuzatishda yakuniy yurishda xato topilmadi.
- Alohida SQLite bazasi, test administrator va sun’iy ma’lumotlar ishlatildi. Amaldagi loyiha bazasi o‘zgartirilmadi.
- Bu sichqoncha bilan inson bajargan qo‘lda tekshiruv emas: haqiqiy Chrome ichida avtomatlashtirilgan funksional tekshiruv. Ayrim skrinshotlar alohida ko‘rib chiqildi.

## Topilgan va tuzatilgan xato

Bo‘sh faoliyat tarixi yoki bildirishnomalar ro‘yxati davriy o‘qilganda records API versiyani `0` deb qaytaradi. Frontend shu qiymatni birinchi saqlashga yuborardi, state API esa hali mavjud bo‘lmagan kolleksiya uchun `null` kutadi. Natijada `409 Conflict` yuzaga kelib, keyingi tahrirlashlar ham sinxronlash xatosi sabab to‘xtardi.

`src/api/backend.js` ichida mavjud bo‘lmagan kolleksiya versiyasi `null` sifatida saqlanadigan qilindi. `Back-end/tests/empty-collection-sync.test.js` faoliyat tarixi va bildirishnomalarning birinchi va keyingi saqlanishini tekshiradi. Tuzatishdan keyin brauzer sinovlari boshidan takrorlandi va barchasi o‘tdi.

## Tekshirilgan ssenariylar

| Yo‘nalish | Tekshiruv |
| --- | --- |
| Kirish | Bo‘sh maydonlar validatsiyasi; test administrator bilan kirish |
| Talabalar, ustozlar, qo‘shimcha ustozlar, guruhlar | Barcha qatorlarni tanlash, qisman tanlash indikatori, tanlovni tozalash, qidiruv va qidiruvni tozalash, qidiruvda tanlovning bekor qilinishi |
| Shu to‘rtta jadval | Saralash tugmalari, faol holat filtri, mavjud yozuvni tahrirlash va yangi izohning serverda saqlanishi |
| Talabalar | Majburiy maydonlar validatsiyasi, qo‘shish, o‘chirish, qaytarish va serverdan natijani tasdiqlash |
| Asosiy va qo‘shimcha ustozlar | Majburiy maydonlar validatsiyasi, qo‘shish, o‘chirish, qaytarish va serverdan natijani tasdiqlash |
| Guruhlar | Yangi guruh, xona va jadval bilan saqlash, o‘chirish, qaytarish va serverdan natijani tasdiqlash |
| Kurslar | Majburiy maydonlar validatsiyasi, qo‘shish, tahrirlash, arxivlash, faollashtirish, o‘chirish va qaytarish; serverdan tasdiqlash |
| Qo‘shimcha sahifalar | Kurslar, dars jadvali, davomat, moliya, to‘lovlar, qarzdorlik, xarajatlar, maoshlar, hisobotlar, foydalanuvchilar va rollar, bildirishnomalar, faoliyat tarixi, sozlamalar, chat ochilishi |
| Mobil ko‘rinish | 390 × 844 o‘lchamda talabalar sahifasi, menyu ochilishi va mavzu almashishi |
| Sessiya | Sahifa yangilangach qayta kirish; kirilmagan holatda himoyalangan talabalar manzilida shaxsiy jadval ko‘rsatilmasligi |

## Dalillar

- Yakuniy brauzer natijalari: `.tmp/browser-check/results.json`.
- Sinov skripti: `.tmp/browser-check/run.mjs`.
- Skrinshotlar: `.tmp/browser-check/`, jumladan `groups.png`, `reports.png`, `mobile-students.png`, `mobile-menu.png`.
- Umumiy avtomatik tekshiruv jurnali: `verification-latest.log`.
- Vaqtinchalik brauzer profillari, sun’iy bazalar va skrinshotlar Git’dan chiqarilgan. Sinov tugagach yordamchi Chrome, API va Vite jarayonlari yopildi.

## Tekshiruv chegaralari

34/34 — bajarilgan ssenariylarning natijasi; butun loyiha 100% xatosiz degani emas. Brauzer sinovlari administrator rolida bajarildi. Reception va teacher rollarining to‘liq UI oqimlari, Firefox/Safari, haqiqiy telefon, real kamera/mikrofon qo‘ng‘iroqlari, barcha moliyaviy yozish oqimlari, tashqi xabar xizmatlari, production muhiti va katta yuklama bu brauzer yurishida tekshirilmadi. Mavjud API testlari ushbu yo‘nalishlarning ayrimlarini alohida qamrab oladi.
