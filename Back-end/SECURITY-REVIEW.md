# Xavfsizlik tekshiruvi — 2026-11-07

Kod tekshiruvi va lokal testlar bajarildi. Bu hisobot server infratuzilmasi yoki barcha hujumlardan himoyalanganlik kafolati emas.

## Kiritilgan himoyalar

- Login uchun mavjud IP + username chekloviga qo'shimcha IP bo'yicha 15 daqiqada 60 urinish chegarasi. Parol almashtirish uchun hisob bo'yicha 8 urinish chegarasi. Cheklovlar jarayon xotirasida, qayta ishga tushganda tiklanadi.
- JSON yozuvlar uchun application/json talabi; ruxsatsiz Origin, preflight va Origin'siz tashqi brauzer yozuvlari rad etiladi.
- Owner hisobini boshqa rollar o'zgartira olmaydi; rol yozuvlarida foydalanuvchining o'zida yo'q huquqlarni berish cheklanadi.
- API uchun CSP va production rejimida HSTS; HTTP so'rov va header vaqt chegaralari.
- CSV eksportida formula va boshqaruv belgisi prefikslarini zararsizlantirish.
- Parol tekshiruvida 256 belgilik chegara.

## Mavjud himoyalar

### Qo'shimcha hujumga qarshi himoyalar

- Har bir bevosita IP uchun daqiqasiga 1200 so'rov, jarayon uchun ko'pi bilan 100 faol so'rov va 10 000 kuzatiladigan IP. Limit javobida Retry-After qaytariladi; uzilgan ulanishlar hisobdan chiqariladi. Chat polling sabab limit yuqori tanlangan.
- Bir vaqtda ko'pi bilan 8 parol hisoblash vazifasi. Eski PBKDF2 tekshiruvi ham asinxron bajariladi.
- URL 4096 belgidan oshsa rad etiladi. Content-Length oldindan tekshiriladi, siqilgan so'rovlar va JSON ichidagi __proto__/constructor/prototype kalitlari qabul qilinmaydi.
- Sessiya tokeni formati bazaga murojaatdan oldin tekshiriladi.

Bu limitlar bitta Node jarayoniga tegishli. Katta hajmli DDoS uchun hosting/CDN darajasida trafik filtrlash, WAF va reverse proxy limitlari talab qilinadi; ular ushbu lokal o'zgarish bilan yoqilmaydi.

HttpOnly/SameSite cookie, production uchun Secure cookie, scrypt parollar, serverda sessiya tokenining SHA-256 xeshi, parametrli SQL, rol va ustoz doirasidagi ruxsatlar, 2 MiB so'rov chegarasi, audit jurnali mavjud.

## Qolgan ishlar va joylashtirish talablari

### Keyingi kuchaytirishlar

- Hisob yaratish, rol nomi orqali rol tanlash, rol tayinlash va yuqori huquqli hisobni tahrirlash/o'chirish yo'llarida huquq chegarasi tekshiriladi.
- Sessiya 12 soat mutlaq muddat bilan cheklanadi. Bir hisob uchun ko'pi bilan 10 sessiya saqlanadi; qayta login joriy hisobning eski cookie sessiyasini almashtiradi.
- Production aniq HTTPS APP_ORIGINS talab qiladi. Noto'g'ri sozlama bilan server ishga tushmaydi.
- Frontend theme inline JavaScript'i tashqi faylga chiqarildi. `deploy/nginx.conf.example` TLS, frontend CSP, trafik/ulanish limitlari, maxfiy fayl yo'llarini bloklash namunasini beradi. Bu konfiguratsiya serverga o'rnatilmagan va Nginx orqali sinovdan o'tmagan. `deploy/README.md` dagi moslashtirish va staging tekshiruvi talab etiladi.

- Sozlamadagi 2FA demo; haqiqiy ikkinchi omil tekshiruvi mavjud emas. Yangi qurilma xabarnomasi ham alohida end-to-end tekshirilishi kerak.
- npm audit tarmoqqa kirish ruxsati rad etilgani uchun yakunlanmadi. Paket zaifliklari bo'yicha xulosa chiqarilmadi.
- Production'da NODE_ENV=production, aniq HTTPS APP_ORIGINS, TLS reverse proxy, API portini tashqariga yopish va SQLite/zaxiralar uchun OS ruxsatlari zarur. Frontend uchun CSP va boshqa headerlar hosting qatlamida ham sozlanishi kerak.
- Reverse proxy ortida IP cheklovi proxy manziliga tushadi. Ishonchli proxy sozlamasisiz X-Forwarded-For qabul qilinmaydi. Ko'p jarayon uchun umumiy rate-limit ombori va tashqi trafik chegarasi kerak.
- Foydalanuvchilarni boshqarish huquqi yuqori ishonch talab qiladi: rol tayinlash va boshqa hisob parolini yangilash imkoniyatlarini minimal xodimlarga bering. Barcha avtorizatsiya oqimlari to'liq pentestdan o'tkazilmadi.
- Brauzerdagi localStorage biznes ma'lumotlari XSS yoki umumiy kompyuterda xavf tug'diradi; umumiy qurilmalar siyosati, sessiya tugaganda tozalash va frontend XSS tekshiruvi alohida zarur.
- Parol siyosati hozir 6 belgigacha pasaytirilishi mumkin; production uchun kamida 12 belgini tanlang. Eski PBKDF2 hisoblar login paytida scrypt'ga o'tadi.
- Zaxira olish va tiklash sinovi, disk shifrlash, monitoring, log saqlash muddati va sirlarni almashtirish infratuzilmada bajariladi. Bootstrap parolini birinchi ishga tushirishdan keyin muhitdan olib tashlang.
