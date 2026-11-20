// src/mail.js — envío de correos (recuperar contraseña, avisos de seguridad)
import nodemailer from "nodemailer";
import { config } from "./config.js";

const { host, port, secure, user, pass, from, resendKey } = config.mail;

// Dos formas de enviar:
//  1. RESEND_API_KEY (producción): API HTTPS de Resend. Muchos hostings (Railway Hobby incluido) bloquean
//     los puertos SMTP 25/465/587, y además así los correos llegan mejor (dominio propio con SPF/DKIM).
//  2. SMTP (desarrollo): Gmail con contraseña de aplicación.
// SMTP solo si está completo (con usuario necesita contraseña); si no, en desarrollo los enlaces salen en la consola.
const smtpCompleto = Boolean(host) && (!user || Boolean(pass));
const smtp = !resendKey && smtpCompleto ? nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined }) : null;

/** Envía por Resend o SMTP. Lanza si falla (quien llama decide). */
async function entregar({ to, subject, text, html, headers }) {
  if (resendKey) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html, ...(headers ? { headers } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const detalle = await r.json().catch(() => ({}));
      throw Object.assign(new Error(`Resend respondió ${r.status}: ${detalle.message ?? detalle.name ?? "error"}`), { code: "ERESEND" });
    }
    return;
  }
  await smtp.sendMail({ from, to, subject, text, html, headers });
}

const transporter = resendKey || smtp ? { sendMail: (m) => entregar(m) } : null;

/** Explica en español los errores típicos de SMTP (sobre todo con Gmail) */
export function explicarErrorCorreo(e) {
  if (e.code === "EAUTH")
    return `Gmail rechazó el usuario o la contraseña. Revisa: (1) SMTP_USER debe ser EXACTAMENTE la cuenta de Google donde creaste la contraseña de aplicación; (2) SMTP_PASS son las 16 letras de esa contraseña de aplicación (no tu clave normal); (3) la cuenta tiene la verificación en 2 pasos activa.`;
  if (e.code === "ESOCKET" || e.code === "ECONNECTION" || e.code === "ETIMEDOUT")
    return `No se pudo conectar a ${host}:${port}. Revisa SMTP_HOST/SMTP_PORT/SMTP_SECURE (Gmail: smtp.gmail.com, 465, true) o el firewall/antivirus.`;
  if (e.code === "EENVELOPE") return "Dirección de correo inválida en MAIL_FROM o en el destinatario.";
  return `${e.code ?? ""} ${e.message}`.trim();
}

if (resendKey) {
  console.log(`✅ Correo listo (Resend): enviando como ${from}`);
} else if (smtp) {
  // Comprobación al arrancar: si algo está mal, se ve en la consola de inmediato
  smtp.verify().then(
    () => console.log(`✅ Correo listo: enviando como ${user}`),
    (e) => console.error(`❌ El correo NO funcionará: ${explicarErrorCorreo(e)}`)
  );
  if (user && !from.toLowerCase().includes(user.toLowerCase())) {
    console.warn(`⚠️  MAIL_FROM (${from}) no coincide con SMTP_USER (${user}). Gmail lo reemplazará por ${user}; usa la misma dirección.`);
  }
}

if (!transporter) {
  console.warn(
    config.isProd
      ? "⚠️  SMTP no configurado: los correos NO se enviarán (configura SMTP_HOST en .env)"
      : "ℹ️  SMTP no configurado: en desarrollo los enlaces de los correos se muestran en esta consola"
  );
}

const escapar = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Plantilla HTML con la marca (estilos en línea: es lo único que respetan Gmail/Outlook). */
function plantilla({ titulo, saludo, parrafos, boton, nota }) {
  const p = parrafos.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapar(t)}</p>`).join("");
  const btn = boton
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="border-radius:8px;background:#F26B1D">
         <a href="${escapar(boton.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${escapar(boton.texto)}</a>
       </td></tr></table>
       <p style="margin:0 0 16px;font-size:12px;color:#64748b">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="color:#2B2F8A;word-break:break-all">${escapar(boton.url)}</span></p>`
    : "";
  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#F26B1D;padding:24px 32px;border-bottom:4px solid #FFC20E">
        <span style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:1px">TELEVENTAS FEST</span><br><span style="font-size:11px;color:#FFF3E8;letter-spacing:2px">TV FRONTERA · CÚCUTA</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:22px;color:#2B2F8A">${escapar(titulo)}</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#334155">${escapar(saludo)}</p>
        ${p}${btn}
        ${nota ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${escapar(nota)}</p>` : ""}
      </td></tr>
      <tr><td style="background:#1C1E5C;padding:16px 32px;font-size:11px;color:#c7c9ef;text-align:center">
        Televentas Fest · TV Frontera · Cúcuta, Norte de Santander · canaltvfrontera@gmail.com<br>Este es un correo automático, por favor no respondas a este mensaje.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** Envía un correo. Nunca lanza: un fallo de SMTP no debe tumbar la petición (se registra en consola). */
export async function enviarCorreo({ para, asunto, titulo, saludo, parrafos, boton, nota }) {
  const texto = [titulo, "", saludo, "", ...parrafos, ...(boton ? ["", `${boton.texto}: ${boton.url}`] : []), ...(nota ? ["", nota] : [])].join("\n");
  if (!transporter) {
    if (!config.isProd) console.log(`\n📧 [correo NO enviado - SMTP sin configurar] Para: ${para}\n   ${asunto}\n${boton ? `   ${boton.url}\n` : ""}`);
    return false;
  }
  try {
    await transporter.sendMail({ from, to: para, subject: asunto, text: texto, html: plantilla({ titulo, saludo, parrafos, boton, nota }) });
    return true;
  } catch (e) {
    console.error("❌ No se pudo enviar el correo:", explicarErrorCorreo(e));
    return false;
  }
}

/**
 * v6: BOLETÍN con tarjetas de noticias. Incluye enlace de baja en el cuerpo y en la cabecera
 * List-Unsubscribe (Gmail muestra "Anular suscripción" y mejora la entrega, menos spam).
 * Devuelve true/false (nunca lanza).
 */
export async function enviarBoletin({ para, asunto, intro, noticias, urlBaja, urlSitio }) {
  const tarjetas = noticias
    .map(
      (n) => `<tr><td style="padding:0 0 20px">
        <a href="${escapar(n.url)}" style="text-decoration:none;color:inherit">
          ${n.imagen ? `<img src="${escapar(n.imagen)}" alt="" width="496" style="display:block;width:100%;max-width:496px;border-radius:10px;margin-bottom:10px">` : ""}
          <span style="display:inline-block;font-size:11px;font-weight:bold;color:#F26B1D;text-transform:uppercase;letter-spacing:1px">${escapar(n.categoria)}</span>
          <h2 style="margin:4px 0 6px;font-size:18px;line-height:1.3;color:#2B2F8A">${escapar(n.titulo)}</h2>
          ${n.resumen ? `<p style="margin:0;font-size:14px;line-height:1.5;color:#475569">${escapar(n.resumen)}</p>` : ""}
          <span style="display:inline-block;margin-top:8px;font-size:13px;font-weight:bold;color:#F26B1D">Leer más →</span>
        </a></td></tr>`
    )
    .join("");
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#F26B1D;padding:24px 32px;border-bottom:4px solid #FFC20E">
        <span style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:1px">TELEVENTAS FEST</span><br><span style="font-size:11px;color:#FFF3E8;letter-spacing:2px">BOLETÍN · TV FRONTERA</span>
      </td></tr>
      <tr><td style="padding:28px 32px 8px">
        ${intro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;white-space:pre-line">${escapar(intro)}</p>` : ""}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${tarjetas}</table>
        <p style="text-align:center;margin:8px 0 24px"><a href="${escapar(urlSitio)}" style="display:inline-block;background:#F26B1D;color:#fff;font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:8px">Visitar Televentas Fest</a></p>
      </td></tr>
      <tr><td style="background:#1C1E5C;padding:16px 32px;font-size:11px;color:#c7c9ef;text-align:center">
        Recibes este correo porque te suscribiste al boletín de Televentas Fest · TV Frontera, Cúcuta.<br>
        <a href="${escapar(urlBaja)}" style="color:#FFC20E">Darme de baja</a>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  const texto = [intro, "", ...noticias.map((n) => `• ${n.titulo}\n  ${n.url}`), "", `Darme de baja: ${urlBaja}`].filter((x) => x !== undefined).join("\n");
  if (!transporter) {
    if (!config.isProd) console.log(`\n📧 [boletín NO enviado - SMTP sin configurar] Para: ${para} · ${asunto}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from,
      to: para,
      subject: asunto,
      text: texto,
      html,
      headers: { "List-Unsubscribe": `<${urlBaja}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return true;
  } catch (e) {
    console.error("❌ Boletín no enviado a", para, "→", explicarErrorCorreo(e));
    return false;
  }
}
