# Xavfsizlik tekshiruvi — 2026-11-09

Bu tekshiruv 100% xavfsizlik kafolati yoki to'liq pentest emas. Ishlab turgan production server, TLS, firewall va zaxiralar tekshirilmadi.

## Tuzatilgan holatlar

- Mavjud bo'lmagan va bloklangan loginlar uchun ham scrypt ishlaydi; login mavjudligini javob vaqtiga qarab aniqlash xavfi kamaytirildi. Barcha vaziyatlarda mutlaq bir xil vaqt kafolatlanmaydi, xususan eski PBKDF2 hisoblarda.
- Bir login uchun IP manzilidan mustaqil, registrga befarq limit: 15 daqiqada 30 urinish. Urinish crypto operatsiyasidan oldin hisoblanadi. Mavjud IP va noto'g'ri parol limitlari saqlanadi.
- Parol tekshiruvi davomida hisob bloklansa, roli yoki paroli almashtirilsa eski hisob holati bilan sessiya yaratilmaydi.
- Parol almashtirish va hisob yaratishda async crypto tugagach autentifikatsiya qayta tekshiriladi.
- So'rov tanasi yuklanayotgan paytda sessiya yoki ruxsat bekor qilinsa, eski ruxsat bilan yozish rad etiladi.

## Paket zaifligi tuzatildi

Qo'shimcha himoya: parol almashtirilganda yangi sessiya tokeni beriladi va barcha eski sessiyalar bekor qilinadi. Takroriy cookie nomlari autentifikatsiya uchun qabul qilinmaydi. JSON so'rovlarida UTF-8 qat'iy tekshiriladi, nesting 40 va qiymatlar soni 100 000 bilan cheklanadi; cheksiz songa aylanuvchi qiymatlar rad etiladi. Bo'sh so'rov tanasida ham ruxsat qayta tekshiriladi.

`npm audit` aniqlagan **high** zaiflik (GHSA-mrwp-f3q8-3g9p) foydalanuvchi ruxsati bilan tuzatildi: `follow-redirects` 1.16.1 dan 1.16.3 ga yangilandi, `package-lock.json` yangilandi. `npm audit fix --ignore-scripts` natijasi: **0 vulnerabilities**. Yangilashdan keyin 18 ta API test, lint va production build muvaffaqiyatli o'tdi. Audit natijasi tekshiruv vaqtidagi ma'lum paket zaifliklariga tegishli.

Manba: https://github.com/advisories/GHSA-mrwp-f3q8-3g9p

## Production cheklovlari

- Limitlar bitta Node jarayonining xotirasida: restartda tozalanadi, bir nechta nusxa orasida bo'lishilmaydi. Ko'p nusxali tizimga umumiy limit ombori kerak.
- Hisob bo'yicha limit muvaffaqiyatli urinishlarni ham hisoblaydi; hujumchi loginni vaqtincha band qilishi mumkin. MFA va moslashtirilgan himoya bilan bu muvozanatni production trafikida baholang.
- DDoS uchun hosting/CDN himoyasi, WAF va monitoring kerak. Ilovadagi limit tarmoq kanalini to'lib qolishdan saqlamaydi.
- HTTPS, DB fayl huquqlari, xizmat foydalanuvchisi, shifrlangan backup va tiklash tekshiruvi uchun `deploy/README.md` ni qo'llang. Nginx namunasi serverga o'rnatilmadi.
- MFA hozir qo'shilmadi; yuqori huquqli hisoblar uchun alohida joriy etish kerak.

Login himoyasi uchun asos: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
