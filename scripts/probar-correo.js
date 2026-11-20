// Uso: npm run probar-correo -- destino@correo.com
// Envía un correo de prueba con la configuración SMTP del .env y explica el error si falla.
import nodemailer from "nodemailer";
import { config } from "../src/config.js";
import { explicarErrorCorreo } from "../src/mail.js";

const [destino] = process.argv.slice(2);
if (!destino) {
  console.error("Uso: npm run probar-correo -- destino@correo.com");
  process.exit(1);
}
const { host, port, secure, user, pass, from } = config.mail;
if (!host) {
  console.error("❌ SMTP_HOST está vacío en .env");
  process.exit(1);
}
const t = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
try {
  await t.verify();
  console.log(`✅ Inicio de sesión correcto en ${host} como ${user}`);
  const info = await t.sendMail({
    from,
    to: destino,
    subject: "Prueba de correo — TV Frontera",
    text: "Si recibes este mensaje, la recuperación de contraseña por correo ya funciona.",
  });
  console.log(`✅ Correo enviado a ${destino} (id ${info.messageId}). Revisa también Spam.`);
  process.exit(0);
} catch (e) {
  console.error("❌", explicarErrorCorreo(e));
  process.exit(1);
}
