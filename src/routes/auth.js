// src/routes/auth.js — BASE: tu archivo original.
// v2: cédula en registro, slug/categoría del negocio, /me con resumen del aliado, PATCH /me y POST /password.
// v3: recuperar contraseña por correo (POST /recuperar y /restablecer), contacto completo obligatorio
//     del aliado al registrarse, y al cambiar la contraseña se cierran las sesiones de otros equipos.
import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { enviarCorreo } from "../mail.js";
import { CAMPOS_USUARIO, authOptional, authSinActividad, clearSessionCookie, marcarDesconectado, requireAuth, setSessionCookie, usuarioPublico } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { negocioBase } from "../schemas.js";
import { SOCIO_VIGENTE_SQL, generarCodigoRef, slugUnico } from "../utils.js";
import { antiBot } from "../middleware/antibot.js";
import { evaluarReferido, registrarReferido } from "../referidos.js";

const router = Router();

// Freno a fuerza bruta: 20 intentos por IP cada 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos, espera unos minutos" },
});

// Más estricto para recuperar contraseña: evita usar el sitio para bombardear correos
const limiterCorreo = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en una hora." },
});

const cedula = z
  .string()
  .trim()
  .regex(/^\d{5,15}$/, "La cédula debe tener solo números (5 a 15 dígitos)");

const password = z.string().min(8, "La contraseña debe tener mínimo 8 caracteres").max(72, "Máximo 72 caracteres");

const negocioSchema = z.object({
  nombre: z.string().trim().min(2, "Nombre del negocio muy corto").max(150),
  ...negocioBase,
});

const registroSchema = z
  .object({
    nombre: z.string().trim().min(2, "Escribe tu nombre completo").max(100),
    email: z.string().trim().toLowerCase().email("Correo inválido").max(150),
    password,
    telefono: z.string().trim().max(30).optional(),
    cedula: cedula.optional().or(z.literal("").transform(() => undefined)),
    rol: z.enum(["CLIENTE", "SOCIO"]).default("CLIENTE"), // ADMIN nunca se crea por aquí
    negocio: negocioSchema.optional(),
    ref: z.string().trim().max(20).optional(), // código de quien lo invitó (programa de referidos)
  })
  .refine((d) => d.rol !== "SOCIO" || !!d.negocio, {
    message: "Los afiliados deben enviar los datos del negocio",
    path: ["negocio"],
  });

async function socioResumen(usuarioId) {
  const [rows] = await db.query(
    `SELECT s.id, s.slug, s.nombre_negocio, s.estado, s.plan, s.pagado_hasta, ${SOCIO_VIGENTE_SQL} AS vigente
       FROM socios s WHERE s.usuario_id = ? LIMIT 1`,
    [usuarioId]
  );
  return rows[0] ? { ...rows[0], vigente: Boolean(rows[0].vigente) } : null;
}

async function usuarioPorId(id) {
  const [rows] = await db.query(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE id = ?`, [id]);
  return usuarioPublico(rows[0]);
}

router.post("/registro", limiter, antiBot, validate(registroSchema), async (req, res) => {
  const d = req.body;
  const hash = await bcrypt.hash(d.password, 12);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Código de invitación único (reintenta en el improbable caso de que ya exista)
    let u;
    for (let intento = 0; ; intento++) {
      try {
        [u] = await conn.query(
          "INSERT INTO usuarios (nombre, email, password_hash, telefono, cedula, rol, codigo_ref, registro_ip) VALUES (?,?,?,?,?,?,?,?)",
          [d.nombre, d.email, hash, d.telefono ?? null, d.cedula ?? null, d.rol, generarCodigoRef(), req.ip ?? null]
        );
        break;
      } catch (e) {
        if (e.code !== "ER_DUP_ENTRY" || !/codigo_ref/.test(e.sqlMessage) || intento > 4) throw e;
      }
    }
    if (d.ref) await registrarReferido(conn, { referidoId: u.insertId, codigo: d.ref, ip: req.ip ?? null, email: d.email });
    if (d.rol === "SOCIO") {
      const n = d.negocio;
      await conn.query(
        `INSERT INTO socios (usuario_id, nombre_negocio, slug, descripcion, categoria, ciudad, direccion, whatsapp, telefono, horario, instagram, facebook)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          u.insertId,
          n.nombre,
          await slugUnico("socios", n.nombre, 0, conn),
          n.descripcion ?? null,
          n.categoria ?? null,
          n.ciudad,
          n.direccion,
          n.whatsapp,
          n.telefono ?? null,
          n.horario ?? null,
          n.instagram ?? null,
          n.facebook ?? null,
        ]
      );
    }
    await conn.commit();
    const user = await usuarioPorId(u.insertId);
    setSessionCookie(res, user);
    res.status(201).json({ user, socio: await socioResumen(u.insertId) });
    enviarConfirmacion(user).catch(() => {});
  } catch (e) {
    await conn.rollback();
    throw e; // ER_DUP_ENTRY (correo/cédula repetidos) lo responde errorHandler con 409
  } finally {
    conn.release();
  }
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(1, "Escribe tu contraseña").max(72),
});
// Hash de relleno: el tiempo de respuesta no revela si el correo existe
const DUMMY_HASH = bcrypt.hashSync("relleno-no-valido", 12);

router.post("/login", limiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query(`SELECT ${CAMPOS_USUARIO}, password_hash FROM usuarios WHERE email = ? LIMIT 1`, [email]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok || !u.activo) return res.status(401).json({ error: "Correo o contraseña incorrectos" });

  setSessionCookie(res, u);
  res.json({ user: usuarioPublico(u), socio: await socioResumen(u.id) });
});

router.post("/logout", authSinActividad, async (req, res) => {
  if (req.user) await marcarDesconectado(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Latido: el sitio lo llama cada 2 min mientras la pestaña está visible (mantiene el "en línea")
router.post("/ping", authOptional, (req, res) => res.json({ ok: Boolean(req.user) }));

// Usuario actual (o null) + resumen de su Punto Aliado. Nunca responde 401.
router.get("/me", authOptional, async (req, res) => {
  if (!req.user) return res.json({ user: null, socio: null });
  res.json({ user: req.user, socio: await socioResumen(req.user.id) });
});

const perfilSchema = z
  .object({
    nombre: z.string().trim().min(2).max(100),
    telefono: z.string().trim().max(30).nullable(),
    cedula: cedula.nullable(),
  })
  .partial();

router.patch("/me", requireAuth(), validate(perfilSchema), async (req, res) => {
  const d = req.body;
  if (d.cedula !== undefined && req.user.verificacion === "VERIFICADO" && d.cedula !== req.user.cedula) {
    return res.status(400).json({ error: "Tu cédula ya fue verificada y no se puede cambiar" });
  }
  const campos = Object.entries(d).filter(([, v]) => v !== undefined);
  if (campos.length) {
    await db.query(`UPDATE usuarios SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [
      ...campos.map(([, v]) => v),
      req.user.id,
    ]);
  }
  if (d.cedula) evaluarReferido(req.user.id);
  res.json({ user: await usuarioPorId(req.user.id) });
});

/** Aviso de seguridad por correo cada vez que cambia la contraseña */
function avisarCambioPassword(u) {
  return enviarCorreo({
    para: u.email,
    asunto: "Tu contraseña de Televentas Fest cambió",
    titulo: "Tu contraseña fue cambiada",
    saludo: `Hola ${u.nombre},`,
    parrafos: [
      "Te confirmamos que la contraseña de tu cuenta de TV Frontera se cambió correctamente. Por seguridad, cerramos tu sesión en los demás equipos.",
      "Si no fuiste tú, recupera tu cuenta de inmediato desde la opción \"¿Olvidaste tu contraseña?\" y escríbenos al +57 310 851 1162.",
    ],
  });
}

const passwordSchema = z.object({
  actual: z.string().min(1, "Escribe tu contraseña actual").max(72),
  nueva: password,
});

router.post("/password", limiter, requireAuth(), validate(passwordSchema), async (req, res) => {
  const [rows] = await db.query("SELECT password_hash, sesion_version FROM usuarios WHERE id = ?", [req.user.id]);
  if (!(await bcrypt.compare(req.body.actual, rows[0].password_hash))) {
    return res.status(400).json({ error: "La contraseña actual no es correcta" });
  }
  const version = rows[0].sesion_version + 1;
  await db.query("UPDATE usuarios SET password_hash = ?, sesion_version = ? WHERE id = ?", [await bcrypt.hash(req.body.nueva, 12), version, req.user.id]);
  await db.query("DELETE FROM password_resets WHERE usuario_id = ?", [req.user.id]);
  // Este equipo sigue con sesión (nueva cookie); los demás quedan fuera
  setSessionCookie(res, { ...req.user, sesion_version: version });
  avisarCambioPassword(req.user);
  res.json({ ok: true });
});

// ---------- Recuperar contraseña por correo ----------
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
const MINUTOS_VALIDEZ = 30;
const MSG_RECUPERAR = "Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.";

router.post(
  "/recuperar",
  limiterCorreo,
  antiBot,
  validate(z.object({ email: z.string().trim().toLowerCase().email("Correo inválido").max(150) })),
  async (req, res) => {
    // Siempre la misma respuesta y de inmediato: no revela qué correos existen
    res.json({ ok: true, mensaje: MSG_RECUPERAR });

    try {
      const [rows] = await db.query("SELECT id, nombre, email, activo FROM usuarios WHERE email = ? LIMIT 1", [req.body.email]);
      const u = rows[0];
      if (!u || !u.activo) return;

      const token = crypto.randomBytes(32).toString("base64url"); // 256 bits, imposible de adivinar
      await db.query("DELETE FROM password_resets WHERE usuario_id = ? OR expira_en < NOW()", [u.id]); // un enlace vivo a la vez
      await db.query(
        `INSERT INTO password_resets (usuario_id, token_hash, expira_en, ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${MINUTOS_VALIDEZ} MINUTE), ?)`,
        [u.id, hashToken(token), req.ip ?? null]
      );
      await enviarCorreo({
        para: u.email,
        asunto: "Restablece tu contraseña de Televentas Fest",
        titulo: "Restablece tu contraseña",
        saludo: `Hola ${u.nombre},`,
        parrafos: [
          "Recibimos una solicitud para restablecer la contraseña de tu cuenta de TV Frontera.",
          `Haz clic en el botón para crear una nueva. El enlace funciona una sola vez y vence en ${MINUTOS_VALIDEZ} minutos.`,
        ],
        boton: { texto: "Crear nueva contraseña", url: `${config.appUrl}/restablecer?token=${token}` },
        nota: "Si no pediste este cambio, ignora este correo: tu contraseña actual sigue funcionando.",
      });
    } catch (e) {
      console.error("Error en /recuperar:", e.code ?? e.message);
    }
  }
);

const restablecerSchema = z.object({
  token: z.string().trim().min(20, "Enlace inválido").max(100),
  nueva: password,
});

router.post("/restablecer", limiter, validate(restablecerSchema), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query(
      `SELECT pr.id, pr.usuario_id, u.nombre, u.email, u.activo
         FROM password_resets pr JOIN usuarios u ON u.id = pr.usuario_id
        WHERE pr.token_hash = ? AND pr.usado_en IS NULL AND pr.expira_en > NOW()
        LIMIT 1 FOR UPDATE`,
      [hashToken(req.body.token)]
    );
    if (!r || !r.activo) {
      await conn.rollback();
      return res.status(400).json({ error: "El enlace no es válido o ya venció. Solicita uno nuevo.", code: "TOKEN_INVALIDO" });
    }
    await conn.query("UPDATE usuarios SET password_hash = ?, sesion_version = sesion_version + 1 WHERE id = ?", [
      await bcrypt.hash(req.body.nueva, 12),
      r.usuario_id,
    ]);
    await conn.query("UPDATE password_resets SET usado_en = NOW() WHERE id = ?", [r.id]);
    await conn.query("DELETE FROM password_resets WHERE usuario_id = ? AND id <> ?", [r.usuario_id, r.id]);
    await conn.commit();
    clearSessionCookie(res); // por si había una sesión vieja en este navegador
    avisarCambioPassword(r);
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// ---------- Confirmación de correo ----------
// Evita cuentas con correos inventados: el referido solo cuenta cuando confirma (requisito EMAIL).
async function enviarConfirmacion(u) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query("DELETE FROM email_verificaciones WHERE usuario_id = ? OR expira_en < NOW()", [u.id]);
  await db.query("INSERT INTO email_verificaciones (usuario_id, token_hash, expira_en) VALUES (?, ?, NOW() + INTERVAL 2 DAY)", [u.id, hashToken(token)]);
  return enviarCorreo({
    para: u.email,
    asunto: "Confirma tu correo en Televentas Fest",
    titulo: "Confirma tu correo",
    saludo: `Hola ${u.nombre},`,
    parrafos: [
      "¡Bienvenido a Televentas Fest! Confirma tu correo para activar todos los beneficios de tu cuenta, incluido el programa de referidos.",
      "El enlace vence en 48 horas.",
    ],
    boton: { texto: "Confirmar mi correo", url: `${config.appUrl}/confirmar?token=${token}` },
    nota: "Si no creaste esta cuenta, ignora este mensaje.",
  });
}

router.post("/confirmar", limiter, validate(z.object({ token: z.string().trim().min(20).max(100) })), async (req, res) => {
  const [[r]] = await db.query("SELECT usuario_id FROM email_verificaciones WHERE token_hash = ? AND expira_en > NOW()", [hashToken(req.body.token)]);
  if (!r) return res.status(400).json({ error: "El enlace no es válido o ya venció. Pide uno nuevo desde Mi cuenta.", code: "TOKEN_INVALIDO" });
  await db.query("UPDATE usuarios SET email_verificado = COALESCE(email_verificado, NOW()) WHERE id = ?", [r.usuario_id]);
  await db.query("DELETE FROM email_verificaciones WHERE usuario_id = ?", [r.usuario_id]);
  await evaluarReferido(r.usuario_id);
  res.json({ ok: true });
});

router.post("/reenviar-confirmacion", limiterCorreo, requireAuth(), async (req, res) => {
  if (req.user.email_verificado) return res.json({ ok: true, mensaje: "Tu correo ya está confirmado." });
  await enviarConfirmacion(req.user);
  res.json({ ok: true, mensaje: "Te enviamos un nuevo enlace. Revisa tu correo (y la carpeta de spam)." });
});

export default router;
