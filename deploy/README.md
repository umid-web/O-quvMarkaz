# Production himoyasi

Bu papka tayyorlash uchun namuna; serverga o'rnatilmadi. Linux + Nginx + alohida Node xizmati uchun mo'ljallangan.

1. Frontendni `npm run build` bilan yig'ing va faqat `dist` papkasini Nginx root'iga joylang. Repozitoriy, `.env` va SQLite fayllarini web-root'ga qo'ymang.
2. `nginx.conf.example` ichida `example.com`, sertifikat va root yo'llarini almashtiring. Faylni Nginx `http {}` kontekstiga kiriting. Avval `nginx -t`, keyin reload bajaring. Bu muhitda Nginx mavjudligi/sintaksisi tekshirilmadi.
3. Node muhiti: `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT=3001`, `APP_ORIGINS=https://sizning-domeningiz`, `COOKIE_SAME_SITE=Lax`. SQLite faylini faqat xizmat foydalanuvchisi o'qiydigan alohida joyda saqlang. Node'ni root/Administrator sifatida ishlatmang.
4. Firewall'da tashqariga faqat HTTPS, kerak bo'lsa HTTP redirect va cheklangan administrator IP'laridan SSH oching. 3001 va Vite portlarini ochmang. Mavjud masofaviy boshqaruv ulanishini tekshirmasdan firewall qoidasini o'zgartirmang.
5. CDN/WAF ishlatilsa, origin serverga kirishni CDN manzillari bilan cheklang. Nginx real-IP ishonch ro'yxatini provayderning aniq IP diapazonlariga sozlang; barcha manbalardan X-Forwarded-For'ga ishonmang. Namuna CDN real-IP konfiguratsiyasini o'z ichiga olmaydi.
6. Zaxiralarni shifrlang, serverdan tashqarida saqlang va tiklashni tekshiring. Ishlayotgan SQLite bazasini oddiy nusxalash o'rniga SQLite backup usulidan foydalaning. Disk va audit/log hajmiga limit, 429/401/5xx ko'payishiga monitoring o'rnating.
7. OS, Node va paket yangilanishlarini tekshirib boring. 2026-11-09 kuni `follow-redirects` 1.16.3 ga yangilandi; audit 0 zaiflik ko'rsatdi. Keyingi yangilashlarda `npm audit`, test, lint va build bajaring.

CSP bir domendagi frontend/API uchun yozilgan. `index.html` ichidagi theme kodi tashqi `theme-init.js` fayliga chiqarilgan. Inline uslublar UI kutubxonalari sabab ruxsat etilgan, inline JavaScript va eval ruxsat etilmagan. Tashqi API, rasmlar yoki media kerak bo'lsa CSP manbalarini aniq ro'yxat bilan moslang. Login, barcha sahifalar, CSV va audio/video qo'ng'iroqlarni HTTPS staging muhitida tekshiring.

Nginx ortida ilova limitlari proxy IP bo'yicha umumiy hisoblanadi: bir nechta foydalanuvchi bitta limitni bo'lishadi. Tarmoq tuzilmasi va trafik o'lchanganidan keyin ishonchli proxy/umumiy limit omborini alohida sozlash kerak. Katta DDoS uchun upstream provayder himoyasi zarur.

Rasmiy ma'lumot: https://nginx.org/en/docs/http/ngx_http_limit_req_module.html va https://nginx.org/en/docs/http/ngx_http_headers_module.html
