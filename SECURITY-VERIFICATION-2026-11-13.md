# Xavfsizlik tekshiruvi: 2026-11-13

## Tekshirilgan doira

- npm audit --json: 158 dependency, 0 ma'lum zaiflik. Bu kelajakdagi yoki noma'lum zaifliklarni istisno qilmaydi.
- Logout endpointi JSON talab qiladi; HTML forma turlari rad etilishi regressiya testida tekshiriladi. Frontend logout so'rovlari moslashtirilgan.
- SQLite yangi katalogi POSIX tizimlarda 0700, baza fayli 0600; jarayon umask 0077 bilan WAL/SHM fayllarini ham himoyalaydi. Windows uchun NTFS ACL kerak. Mavjud katalog va sidecar fayllarning eski ruxsatlari avtomatik o'zgartirilmaydi.
- CI endi npm audit orqali low va undan yuqori ma'lum zaifliklarda to'xtaydi.
- Backup testi WAL dagi yozuvlar zaxiraga kirishini, qayta ochib o'qilishini va mavjud fayl ustiga yozilmasligini tekshiradi.

## Production uchun qolgan dalillar

## Qo'shimcha lokal sessiya tekshiruvi

Bloklangan hisob sessiya bilan murojaat qilganda endi uning barcha sessiyalari o'chiriladi; sessiya muddati uzaytirilmaydi. Hisob qayta yoqilganda eski tokenlar ishlamasligi regressiya testida tekshirildi. Bu odatiy hisob tahrirlashdagi sessiyalarni bekor qilish himoyasini to'ldiradi. npm run verify: lint, 96 test va production build muvaffaqiyatli o'tdi.

Bu workspace ichida ishlayotgan production domeni va server ulanishi berilmagan. Nginx ushbu muhitda topilmadi. Shu sababli TLS sertifikati, amaldagi firewall, xizmat foydalanuvchisi, Windows NTFS ACL, serverdan tashqaridagi shifrlangan backup va real tiklash jarayoni tekshirilgani da'vo qilinmaydi.

deploy/nginx.conf.example tayyor namuna; uni o'qish production serverga o'rnatilganini anglatmaydi. Deploy qilingach nginx -t va haqiqiy HTTPS endpoint tekshiruvi zarur. Mutlaq xavfsizlik kafolati berilmaydi.
