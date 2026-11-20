// src/routes/suscriptores.js — NUEVO v5. Boletín "No te pierdas ninguna noticia"
//   POST /                 (público) suscribirse: guarda el correo y envía bienvenida con enlace de baja
//   POST /baja {token}     (público) darse de baja con el enlace del correo
//   GET  /                 (ADMIN) lista con búsqueda; ?todos=1 para exportar
//   DELETE /:id            (ADMIN) borrar definitivamente (derecho de supresión, Ley 1581)
import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { enviarBoletin, enviarCorreo } from "../mail.js";
import { antiBot } from "../middleware/antibot.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { CATEGORIAS_NOTICIA, idValido, paginar } from "../utils.js";

const router = Router();

// Evita que usen el formulario para inscribir correos ajenos en masa
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta más tarde." },
});

const MSG_OK = "¡Listo! Te suscribiste al boletín. Revisa tu correo (y la carpeta de spam).";

router.post(
  "/",
  limiter,
  antiBot,
  validate(
    z.object({
      email: z.string().trim().toLowerCase().email("Escribe un correo válido").max(150),
      origen: z.string().trim().max(40).optional(),
      acepta: z.literal(true, { error: "Debes aceptar la política de datos" }),
    })
  ),
  async (req, res) => {
    const { email, origen } = req.body;
    const [[ya]] = await db.query("SELECT id, activo, token_baja FROM suscriptores WHERE email = ?", [email]);
    let token = ya?.token_baja;
    if (!ya) {
      token = crypto.randomBytes(32).toString("base64url");
      await db.query("INSERT INTO suscriptores (email, token_baja, origen) VALUES (?,?,?)", [email, token, origen ?? null]);
    } else if (!ya.activo) {
      await db.query("UPDATE suscriptores SET activo = 1, baja_en = NULL WHERE id = ?", [ya.id]);
    }
    // Misma respuesta si ya estaba suscrito: no revela qué correos están en la lista
    res.status(201).json({ ok: true, mensaje: MSG_OK });
    if (!ya || !ya.activo) {
      enviarCorreo({
        para: email,
        asunto: "¡Bienvenido al boletín de Televentas Fest!",
        titulo: "¡Gracias por suscribirte!",
        saludo: "Hola,",
        parrafos: [
          "Desde ahora recibirás las noticias más importantes de Cúcuta y la frontera, las novedades de Televentas Fest y la información del sorteo anual.",
          "Si no fuiste tú quien se suscribió, puedes darte de baja con un clic.",
        ],
        boton: { texto: "Visitar Televentas Fest", url: config.appUrl },
        nota: `¿Ya no quieres recibir correos? Date de baja aquí: ${config.appUrl}/baja?token=${token}`,
      });
    }
  }
);

router.post("/baja", validate(z.object({ token: z.string().trim().min(20).max(60) })), async (req, res) => {
  const [r] = await db.query("UPDATE suscriptores SET activo = 0, baja_en = NOW() WHERE token_baja = ? AND activo = 1", [req.body.token]);
  // Respuesta idéntica exista o no el token
  res.json({ ok: true, mensaje: "Listo. Ya no recibirás el boletín.", cambiado: r.affectedRows > 0 });
});

// ---------- Admin ----------
router.get("/", requireAuth("ADMIN"), async (req, res) => {
  const todos = req.query.todos === "1";
  const { page, limit, offset } = todos ? { page: 1, limit: 10000, offset: 0 } : paginar(req.query, 25);
  const where = [];
  const params = [];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("email LIKE ?");
    params.push(`%${q}%`);
  }
  if (req.query.estado === "activos") where.push("activo = 1");
  if (req.query.estado === "bajas") where.push("activo = 0");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[{ total, activos }]] = await db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(activo), 0) AS activos FROM suscriptores ${w}`, params);
  const [rows] = await db.query(
    `SELECT id, email, activo, origen, created_at, baja_en FROM suscriptores ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({
    suscriptores: rows.map((r) => ({ ...r, activo: Boolean(r.activo) })),
    total,
    activos: Number(activos),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.delete("/:id", requireAuth("ADMIN"), async (req, res) => {
  await db.query("DELETE FROM suscriptores WHERE id = ?", [idValido(req.params.id) ?? 0]);
  res.json({ ok: true });
});

// ---------- Enviar boletín (ADMIN) ----------
// Nada se envía solo: el admin elige las noticias, lo prueba en su correo y luego lo envía a todos.
// Se envía de a uno con una pausa corta (Gmail personal permite ~500 correos al día).
const PAUSA_MS = 1200;
const etiquetaCat = (c) => ({ economia: "Economía", local: "Local", nacional: "Nacional", deportes: "Deportes", entretenimiento: "Entretenimiento", sucesos: "Sucesos" })[c] ?? c;

const envioSchema = z.object({
  asunto: z.string().trim().min(3, "Escribe el asunto").max(200),
  intro: z.string().trim().max(2000).optional(),
  noticia_ids: z.array(z.number().int().positive()).max(10).default([]),
  prueba: z.boolean().default(false),
});

router.post("/enviar", requireAuth("ADMIN"), validate(envioSchema), async (req, res) => {
  const d = req.body;
  if (!d.noticia_ids.length && !d.intro) return res.status(400).json({ error: "Agrega un mensaje o elige al menos una noticia" });
  const [filas] = d.noticia_ids.length
    ? await db.query("SELECT id, slug, titulo, resumen, categoria, imagen_url FROM noticias WHERE id IN (?) AND estado = 'PUBLICADA'", [d.noticia_ids])
    : [[]];
  // Mismo orden en que el admin las eligió
  const noticias = d.noticia_ids
    .map((id) => filas.find((n) => n.id === id))
    .filter(Boolean)
    .map((n) => ({
      titulo: n.titulo,
      resumen: n.resumen,
      categoria: CATEGORIAS_NOTICIA.includes(n.categoria) ? etiquetaCat(n.categoria) : n.categoria,
      imagen: n.imagen_url?.startsWith("https://") ? n.imagen_url : null, // los correos solo cargan imágenes públicas https
      url: `${config.appUrl}/noticias/${n.slug}`,
    }));
  const base = { asunto: d.asunto, intro: d.intro, noticias, urlSitio: config.appUrl };

  if (d.prueba) {
    const ok = await enviarBoletin({ ...base, para: req.user.email, urlBaja: `${config.appUrl}/baja?token=prueba` });
    return ok ? res.json({ ok: true, mensaje: `Prueba enviada a ${req.user.email}` }) : res.status(502).json({ error: "No se pudo enviar la prueba. Revisa la configuración del correo (SMTP)." });
  }

  const [[enCurso]] = await db.query("SELECT id FROM boletin_envios WHERE estado = 'ENVIANDO' AND created_at > NOW() - INTERVAL 6 HOUR LIMIT 1");
  if (enCurso) return res.status(409).json({ error: "Ya hay un boletín enviándose. Espera a que termine." });
  const [destinos] = await db.query("SELECT email, token_baja FROM suscriptores WHERE activo = 1 ORDER BY id");
  if (!destinos.length) return res.status(400).json({ error: "No hay suscriptores activos" });
  const [r] = await db.query("INSERT INTO boletin_envios (asunto, destinatarios, admin_id) VALUES (?,?,?)", [d.asunto, destinos.length, req.user.id]);
  res.status(202).json({ ok: true, envio_id: r.insertId, destinatarios: destinos.length });

  // En segundo plano: la respuesta ya salió, el admin ve el progreso en el historial
  (async () => {
    let enviados = 0;
    let fallidos = 0;
    for (const s of destinos) {
      const ok = await enviarBoletin({ ...base, para: s.email, urlBaja: `${config.appUrl}/baja?token=${s.token_baja}` });
      ok ? enviados++ : fallidos++;
      if ((enviados + fallidos) % 10 === 0) await db.query("UPDATE boletin_envios SET enviados = ?, fallidos = ? WHERE id = ?", [enviados, fallidos, r.insertId]);
      await new Promise((ok) => setTimeout(ok, PAUSA_MS));
    }
    await db.query("UPDATE boletin_envios SET enviados = ?, fallidos = ?, estado = 'TERMINADO', terminado_en = NOW() WHERE id = ?", [enviados, fallidos, r.insertId]);
  })().catch((e) => console.error("Envío de boletín:", e.message));
});

router.get("/envios", requireAuth("ADMIN"), async (_req, res) => {
  const [rows] = await db.query("SELECT id, asunto, destinatarios, enviados, fallidos, estado, created_at, terminado_en FROM boletin_envios ORDER BY id DESC LIMIT 20");
  res.json({ envios: rows });
});

export default router;
