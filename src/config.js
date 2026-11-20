import "dotenv/config";
import { networkInterfaces } from "node:os";

/** IPv4 de este equipo en la red local (Wi-Fi / cable) */
const ipsLocales = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

function desdeUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "tvfrontera",
  };
}

// En el servidor (NODE_ENV=production o Railway) los secretos son OBLIGATORIOS: sin ellos la API no arranca.
// En tu PC, si están vacíos en .env, se usa una clave de desarrollo fija para que el proyecto funcione al clonarlo.
// La web usa el mismo valor de desarrollo para REVALIDATE_SECRET (src/app/api/revalidar/route.ts).
const enServidor = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

function secreto(key) {
  const v = process.env[key];
  if (v) return v;
  if (enServidor) throw new Error(`Falta la variable de entorno ${key} (obligatoria en producción)`);
  return `desarrollo-local-no-usar-en-produccion-${key}`;
}

const authSecret = secreto("AUTH_SECRET");
if (authSecret.length < 32) throw new Error("AUTH_SECRET debe tener al menos 32 caracteres");

const sameSite = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
const secure = process.env.COOKIE_SECURE === "true";
if (sameSite === "none" && !secure) {
  throw new Error("COOKIE_SAMESITE=none exige COOKIE_SECURE=true (y HTTPS)");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === "production",
  corsOrigins: [
    ...(process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim().replace(/\/$/, "")),
    // Solo desarrollo: la web abierta desde el celular con la IP de este equipo (se detecta sola)
    ...(process.env.NODE_ENV === "production" ? [] : ipsLocales().map((ip) => `http://${ip}:3000`)),
  ].filter(Boolean),
  jwtSecret: authSecret,
  cookie: {
    name: "tvf_session",
    sameSite,
    secure,
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  // true = solo cuentas VERIFICADAS (cédula + rostro) pueden ser Punto Aliado
  exigirVerificacionAliado: process.env.EXIGIR_VERIFICACION_ALIADO === "true",
  // true = WhatsApp/teléfono/dirección de los aliados visibles SIN iniciar sesión
  contactoPublicoAliados: process.env.CONTACTO_PUBLICO_ALIADOS === "true",
  // URL pública del FRONTEND: se usa en los enlaces de los correos (recuperar contraseña)
  appUrl: (process.env.APP_URL ?? (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",")[0]).trim().replace(/\/$/, ""),
  // Secreto compartido con la web (REVALIDATE_SECRET en ambos .env): la API avisa a Next
  // que borre la caché cuando el admin o un aliado cambia algo, así se ve al instante.
  revalidateSecret: secreto("REVALIDATE_SECRET"),
  // Cloudflare Turnstile (anti-robots). Vacío = desactivado (quedan el campo trampa y el tiempo mínimo)
  turnstileSecret: process.env.TURNSTILE_SECRET || "",
  // URL pública de ESTA API (para las fotos importadas de Facebook que se sirven desde /uploads)
  apiUrl: (process.env.API_URL || `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, ""),
  // Facebook: importar publicaciones de la página como noticias (ver README)
  facebook: {
    pageId: process.env.FB_PAGE_ID || "",
    token: process.env.FB_PAGE_TOKEN || "",
    minutos: Math.max(5, Number(process.env.FB_SYNC_MINUTOS ?? 15)),
  },
  // Correo saliente (SMTP). Si falta SMTP_HOST, en desarrollo el enlace se muestra en la consola.
  mail: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "Televentas Fest <no-responder@tvfrontera.com>",
    // Producción: clave de https://resend.com (envío por HTTPS). Si está, se ignora el SMTP.
    resendKey: process.env.RESEND_API_KEY || "",
  },
  // DATABASE_URL (mysql://usuario:clave@host:puerto/base) tiene prioridad: así la entregan Railway y
  // otros hostings. Si no está, se usan DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y DB_NAME (XAMPP en local).
  db: process.env.DATABASE_URL ? desdeUrl(process.env.DATABASE_URL) : {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "tvfrontera",
  },
};
