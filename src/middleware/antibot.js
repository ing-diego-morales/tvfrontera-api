// src/middleware/antibot.js — NUEVO v6. Freno a robots en formularios públicos (registro, recuperar, boletín)
// Tres capas, de la más barata a la más fuerte:
//   1. Campo trampa "sitio_web": invisible para personas; los robots lo llenan -> rechazado.
//   2. Tiempo mínimo: una persona tarda más de 3 s en llenar el formulario; un robot, milisegundos.
//   3. Cloudflare Turnstile (gratis, sin "selecciona los semáforos"): se activa solo si TURNSTILE_SECRET está en .env.
// Además cada ruta tiene su límite de intentos por IP (express-rate-limit).
import { config } from "../config.js";

const TIEMPO_MINIMO_MS = 3000;

export async function antiBot(req, res, next) {
  const b = req.body ?? {};
  // Respuesta genérica: no le explicamos al robot qué lo delató
  const rechazar = () => res.status(400).json({ error: "No pudimos procesar el formulario. Recarga la página e intenta de nuevo.", code: "ANTIBOT" });

  if (typeof b.sitio_web === "string" && b.sitio_web.trim() !== "") return rechazar();
  const t = Number(b.t_formulario);
  if (b.t_formulario !== undefined && (!Number.isFinite(t) || t < TIEMPO_MINIMO_MS)) return rechazar();

  if (config.turnstileSecret) {
    const token = typeof b.cf_turnstile === "string" ? b.cf_turnstile : "";
    if (!token) return res.status(400).json({ error: "Confirma que no eres un robot.", code: "CAPTCHA" });
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: req.ip ?? "" }),
        signal: AbortSignal.timeout(5000),
      });
      const d = await r.json();
      if (!d.success) return res.status(400).json({ error: "La verificación anti-robots falló. Intenta de nuevo.", code: "CAPTCHA" });
    } catch {
      return res.status(503).json({ error: "No pudimos verificar el formulario. Intenta en un momento.", code: "CAPTCHA" });
    }
  }

  // Estos campos no siguen hacia la validación ni la BD
  delete b.sitio_web;
  delete b.t_formulario;
  delete b.cf_turnstile;
  next();
}
