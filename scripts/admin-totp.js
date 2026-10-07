// Generates a TOTP secret for the admin panel.
// Usage: npm run admin:totp -- you@gmail.com
import { generateSecret } from '../server/totp.js';

const email = process.argv[2] || 'admin';
const secret = generateSecret();
const uri = `otpauth://totp/Limoninior:${encodeURIComponent(email)}?secret=${secret}&issuer=Limoninior&algorithm=SHA1&digits=6&period=30`;

console.log(`
Секрет для админки сгенерирован.

1) Добавьте в .env на сервере:
   ADMIN_TOTP_SECRET=${secret}

2) Добавьте ключ в приложение-аутентификатор (Google Authenticator, Яндекс Ключ, Aegis и т.п.):
   вручную: ${secret}
   или ссылкой: ${uri}

3) Перезапустите сервер. Никому не показывайте этот секрет.
`);
