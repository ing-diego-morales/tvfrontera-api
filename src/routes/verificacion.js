// src/routes/verificacion.js — v7. Verificación de identidad tipo "Face ID": selfie EN VIVO + cédula por ambos lados.
// El usuario toma las fotos con la cámara desde el sitio; el ADMIN compara rostro y cédula y aprueba o rechaza.
//
// Seguridad y privacidad (datos biométricos = datos SENSIBLES, Ley 1581 de 2012):
//   - Autorización expresa obligatoria (se guarda la fecha)
//   - Archivos FUERA de la carpeta pública (privado/verificaciones), con nombre aleatorio
//   - Solo JPEG reales (se revisa la firma del archivo, no la extensión), máx. 3 MB cada uno
//   - El navegador re-dibuja las fotos antes de enviarlas: se eliminan metadatos como la ubicación GPS
//   - Solo el ADMIN las ve, sin caché; puede borrarlas cuando ya decidió
//
//   Usuario: POST /fotos · GET /mia
//   Admin:   GET /admin · GET /admin/:id/foto/:tipo · PATCH /admin/:id · DELETE /admin/:id/fotos
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { enviarCorreo } from "../mail.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { evaluarReferido } from "../referidos.js";
import { idValido, paginar } from "../utils.js";

const router = Router();
// Fuera de /uploads (nunca públicas). En producción van al disco persistente (DATA_DIR).
export const CARPETA_PRIVADA = path.resolve(process.env.DATA_DIR || ".", "privado", "verificaciones");
const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = { selfie: "selfie", frente: "cedula_frente", reverso: "cedula_reverso" };

const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Hiciste demasiados intentos hoy. Intenta mañana." },
});

/** data:image/jpeg;base64,... -> Buffer, solo si es un JPEG real y del tamaño permitido */
function jpegValido(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 5_000 || buf.length > MAX_BYTES) return null; // ni miniaturas ni archivos gigantes
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null; // firma JPEG
  return buf;
}

async function guardar(usuarioId, buf) {
  const carpeta = path.join(CARPETA_PRIVADA, String(usuarioId));
  await fs.mkdir(carpeta, { recursive: true });
  const nombre = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  await fs.writeFile(path.join(carpeta, nombre), buf, { mode: 0o600 });
  return nombre;
}

async function borrarFotos(v) {
  for (const col of Object.values(TIPOS)) {
    if (v[col]) await fs.rm(path.join(CARPETA_PRIVADA, String(v.usuario_id), path.basename(v[col])), { force: true }).catch(() => {});
  }
}

const fotosSchema = z.object({
  cedula: z.string().trim().regex(/^\d{5,15}$/, "La cédula debe tener solo números (5 a 15 dígitos)"),
  selfie: z.string().max(5_000_000),
  frente: z.string().max(5_000_000),
  reverso: z.string().max(5_000_000),
  consentimiento: z.literal(true, { error: "Debes autorizar el tratamiento de tus datos biométricos" }),
});

// ---------- Usuario ----------
router.post("/fotos", limiter, requireAuth(), validate(fotosSchema), async (req, res) => {
  const u = req.user;
  if (u.verificacion === "VERIFICADO") return res.json({ estado: "VERIFICADO" });
  if (u.rol === "ADMIN") return res.status(400).json({ error: "Las cuentas de administrador no necesitan verificación" });
  if (u.cedula && u.cedula !== req.body.cedula) {
    return res.status(400).json({ error: "La cédula no coincide con la registrada en tu cuenta. Corrígela en Mis datos o escríbenos." });
  }
  const fotos = { selfie: jpegValido(req.body.selfie), frente: jpegValido(req.body.frente), reverso: jpegValido(req.body.reverso) };
  for (const [k, v] of Object.entries(fotos)) {
    if (!v) return res.status(400).json({ error: `La foto "${k === "selfie" ? "de tu rostro" : `de la cédula (${k})`}" no es válida. Tómala de nuevo.` });
  }

  // Si no tenía cédula, se registra ahora (es única: si ya existe en otra cuenta responde 409)
  if (!u.cedula) await db.query("UPDATE usuarios SET cedula = ? WHERE id = ?", [req.body.cedula, u.id]);

  // Una solicitud pendiente a la vez: si reenvía, se reemplaza la anterior
  const [anteriores] = await db.query("SELECT * FROM verificaciones WHERE usuario_id = ? AND estado = 'PENDIENTE'", [u.id]);
  for (const a of anteriores) await borrarFotos(a);
  await db.query("DELETE FROM verificaciones WHERE usuario_id = ? AND estado = 'PENDIENTE'", [u.id]);

  const nombres = {
    selfie: await guardar(u.id, fotos.selfie),
    cedula_frente: await guardar(u.id, fotos.frente),
    cedula_reverso: await guardar(u.id, fotos.reverso),
  };
  await db.query(
    "INSERT INTO verificaciones (usuario_id, cedula, selfie, cedula_frente, cedula_reverso, consentimiento_en, ip) VALUES (?,?,?,?,?,NOW(),?)",
    [u.id, req.body.cedula, nombres.selfie, nombres.cedula_frente, nombres.cedula_reverso, req.ip ?? null]
  );
  await db.query("UPDATE usuarios SET verificacion = 'PENDIENTE' WHERE id = ?", [u.id]);
  res.status(201).json({ estado: "PENDIENTE", mensaje: "Recibimos tus fotos. Un administrador comparará tu rostro con tu cédula y te avisaremos por correo." });
});

router.get("/mia", requireAuth(), async (req, res) => {
  const [[v]] = await db.query("SELECT estado, motivo, created_at, revisado_en FROM verificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT 1", [req.user.id]);
  res.json({ verificacion: req.user.verificacion, ultima: v ?? null });
});

// Compatibilidad: el botón antiguo "Verificar mi identidad" ahora pide las fotos
router.post("/iniciar", requireAuth(), (_req, res) => res.status(400).json({ error: "Ahora la verificación se hace con fotos desde Mi cuenta > Mis datos." }));

// ---------- Admin ----------
const admin = requireAuth("ADMIN");

router.get("/admin", admin, async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 20);
  const estado = ["PENDIENTE", "APROBADA", "RECHAZADA"].includes(req.query.estado) ? req.query.estado : "PENDIENTE";
  const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM verificaciones WHERE estado = ?", [estado]);
  const [rows] = await db.query(
    `SELECT v.id, v.cedula, v.estado, v.motivo, v.created_at, v.revisado_en, v.fotos_borradas,
            u.id AS usuario_id, u.nombre, u.email, u.cedula AS cedula_cuenta, u.rol, r.nombre AS revisor
       FROM verificaciones v JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN usuarios r ON r.id = v.revisado_por
      WHERE v.estado = ? ORDER BY v.created_at ${estado === "PENDIENTE" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
    [estado, limit, offset]
  );
  res.json({ verificaciones: rows.map((r) => ({ ...r, fotos_borradas: Boolean(r.fotos_borradas) })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get("/admin/:id/foto/:tipo", admin, async (req, res) => {
  const col = TIPOS[req.params.tipo];
  const id = idValido(req.params.id);
  if (!col || !id) return res.status(400).json({ error: "Solicitud inválida" });
  const [[v]] = await db.query(`SELECT usuario_id, ${col} AS archivo, fotos_borradas FROM verificaciones WHERE id = ?`, [id]);
  if (!v || !v.archivo || v.fotos_borradas) return res.status(404).json({ error: "Foto no disponible" });
  // Datos sensibles: nunca en caché del navegador ni de intermediarios
  res.set({ "Cache-Control": "no-store, private", "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" });
  res.sendFile(path.join(CARPETA_PRIVADA, String(v.usuario_id), path.basename(v.archivo)), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Foto no disponible" });
  });
});

router.patch(
  "/admin/:id",
  admin,
  validate(z.object({ estado: z.enum(["APROBADA", "RECHAZADA"]), motivo: z.string().trim().max(300).optional() })),
  async (req, res) => {
    const id = idValido(req.params.id);
    const [[v]] = await db.query("SELECT v.*, u.nombre, u.email FROM verificaciones v JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ?", [id ?? 0]);
    if (!v) return res.status(404).json({ error: "Verificación no encontrada" });
    const aprobada = req.body.estado === "APROBADA";
    await db.query("UPDATE verificaciones SET estado = ?, motivo = ?, revisado_por = ?, revisado_en = NOW() WHERE id = ?", [
      req.body.estado,
      req.body.motivo ?? null,
      req.user.id,
      v.id,
    ]);
    await db.query("UPDATE usuarios SET verificacion = ? WHERE id = ?", [aprobada ? "VERIFICADO" : "RECHAZADO", v.usuario_id]);
    if (aprobada) evaluarReferido(v.usuario_id);
    res.json({ ok: true });
    enviarCorreo({
      para: v.email,
      asunto: aprobada ? "¡Tu identidad fue verificada!" : "No pudimos verificar tu identidad",
      titulo: aprobada ? "Identidad verificada" : "Verificación no aprobada",
      saludo: `Hola ${v.nombre},`,
      parrafos: aprobada
        ? ["Revisamos tus fotos y tu identidad quedó verificada en Televentas Fest. Ahora tu perfil muestra la insignia de verificado."]
        : [`Revisamos tus fotos y no pudimos confirmar tu identidad.${req.body.motivo ? ` Motivo: ${req.body.motivo}.` : ""}`, "Puedes intentarlo de nuevo desde Mi cuenta: usa buena luz, sin gafas oscuras ni gorra, y que la cédula se lea completa."],
      boton: { texto: "Ir a Mi cuenta", url: `${config.appUrl}/cuenta` },
    }).catch(() => {});
  }
);

router.delete("/admin/:id/fotos", admin, async (req, res) => {
  const [[v]] = await db.query("SELECT * FROM verificaciones WHERE id = ?", [idValido(req.params.id) ?? 0]);
  if (!v) return res.status(404).json({ error: "Verificación no encontrada" });
  if (v.estado === "PENDIENTE") return res.status(400).json({ error: "Primero aprueba o rechaza la verificación" });
  await borrarFotos(v);
  await db.query("UPDATE verificaciones SET fotos_borradas = 1, selfie = NULL, cedula_frente = NULL, cedula_reverso = NULL WHERE id = ?", [v.id]);
  res.json({ ok: true });
});

// Webhook de un proveedor KYC externo (futuro). OJO: el middleware anti-CSRF solo bloquea si viene header Origin.
router.post("/webhook", (_req, res) => {
  res.status(501).json({ error: "Proveedor de verificación aún no configurado" });
});

export default router;
