# Loyiha tekshiruvi — 2026-11-09

## Tuzatilgan kamchiliklar

- Logout va 401 javobidan keyin qoladigan shaxsiy kesh, identifikatorlar va yozish navbati markazlashgan holda tozalanadi.
- Oldingi sessiyadan kechikkan javob tozalangan keshni tiklay olmaydi: sessiya avlodi tekshiriladi.
- Login bo'sh bazaga eski brauzer ma'lumotlarini avtomatik import qilmaydi. Boshlang'ich rollar alohida yaratiladi.
- API so'rovlari 15 soniya bilan cheklanadi; chaqiruvchining abort signali ham saqlanadi.
- Reception dashboard huquqi bo'lmagan foydalanuvchini birinchi ruxsatli modulga yo'naltiradi.
- Reception maoshlar sahifasi uchun `salaries.view` bilan himoyalangan route qo'shildi.
- Ulanmagan 2FA va yangi qurilma xabari tugmalari nofaol qilindi. Bu MFA joriy qilindi degani emas.

## Tekshirish

- `npm run test:api`: 20/20 muvaffaqiyatli. Kesh testiga logout, kechikkan javob, 401, avtomatik import qilmaslik va abort signali tekshiruvlari qo'shildi.
- `npm run lint` va `npm run build`: muvaffaqiyatli.
- Brauzerda qo'lda to'liq foydalanuvchi oqimi tekshirilmadi. Production server tekshirilmadi.

## Qolgan cheklovlar

- Haqiqiy MFA, yangi qurilma aniqlash va tashqi xabar yuborish hali joriy qilinmagan. SMS/Telegram va ayrim sozlamalar demo sifatida belgilangan.
- Shaxsiy localStorage keshi keyingi o'zgarishda olib tashlandi; har tab uchun RAM React store joriy qilindi. Yangilangan holat: [MEMORY-STORAGE-MIGRATION.md](MEMORY-STORAGE-MIGRATION.md).
- Logout tarmoq uzilishi bilan muvaffaqiyatsiz tugasa, mahalliy holat tozalanadi, ammo server sessiyasining bekor qilingani tasdiqlanmaydi; server timeoutigacha cookie amal qilishi mumkin.
- HTTPS, firewall, monitoring, DB fayl huquqlari, backup va tiklash real serverda sozlanishi va tekshirilishi kerak. `deploy/README.md` namunasi avtomatik o'rnatilmagan.
- Ko'p Node nusxalari uchun umumiy rate-limit ombori yo'q. Mustaqil pentest bajarilmadi.

Hisobot tekshirilgan qismlarni qamrab oladi; barcha ehtimoliy nuqsonlar topilganini yoki 100% xavfsizlikni bildirmaydi.
