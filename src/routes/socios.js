// src/routes/socios.js — BASE: tu archivo original.
// Se mantiene tu regla: sin sesión se ve el directorio pero NO los datos de contacto
// (salvo que CONTACTO_PUBLICO_ALIADOS=true en .env).
// v2: solo aliados al día, tienda pública por slug, solicitud para clientes, bloqueo por membresía.
// v3: contacto completo obligatorio (WhatsApp + dirección), horario y redes, posicionamiento
//     (impulso pagado > Premium > prioridad > rotación diaria), filtro por categoría y GET /categorias.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { authOptional, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { cargarSocio, exigirSocioVigente, motivoInactivo } from "../middleware/socio.js";
import { config } from "../config.js";
import { negocioBase, opcional } from "../schemas.js";
import { DISPONIBLE_SQL, EN_LINEA_SQL, ORDEN_SOCIOS_SQL, SOCIO_DESTACADO_SQL, SOCIO_VIGENTE_SQL, avisarWeb, paginar, slugUnico } from "../utils.js";

const router = Router();

// Público: lo que cualquiera ve (horario y redes sociales ya son públicos por naturaleza)
const PUBLICO = `s.id, s.slug, s.nombre_negocio, s.descripcion, s.categoria, s.ciudad, s.logo_url, s.plan,
                 s.horario, s.instagram, s.facebook, ${SOCIO_DESTACADO_SQL} AS destacado,
                 (u.verificacion = 'VERIFICADO') AS verificado, ${EN_LINEA_SQL} AS en_linea`;
// Las consultas que usan PUBLICO deben unir usuarios con alias "u"
const CON_USUARIO = "socios s JOIN usuarios u ON u.id = s.usuario_id";
// Protegido: solo con sesión (evita que robots recolecten teléfonos)
const CONTACTO = "s.direccion, s.whatsapp, s.telefono";
const MSG_RESTRINGIDO = "Inicia sesión o regístrate para ver los datos de contacto";

const verContacto = (req) => Boolean(req.user) || config.contactoPublicoAliados;
const normalizar = (r) => ({ ...r, destacado: Boolean(r.destacado), verificado: Boolean(r.verificado), en_linea: Boolean(r.en_linea) });

// ---------- Directorio público ----------
router.get("/", authOptional, async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 12);
  const where = [SOCIO_VIGENTE_SQL];
  const params = [];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(s.nombre_negocio LIKE ? OR s.descripcion LIKE ? OR s.categoria LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.ciudad) {
    where.push("s.ciudad = ?");
    params.push(String(req.query.ciudad));
  }
  if (req.query.categoria) {
    where.push("s.categoria = ?");
    params.push(String(req.query.categoria));
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const contacto = verContacto(req);
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM socios s ${w}`, params);
  const [rows] = await db.query(
    `SELECT ${PUBLICO}${contacto ? `, ${CONTACTO}` : ""},
            (SELECT COUNT(*) FROM productos p WHERE p.socio_id = s.id AND p.activo = 1) AS total_productos
       FROM ${CON_USUARIO} ${w}
      ORDER BY ${ORDEN_SOCIOS_SQL}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({
    restringido: !contacto,
    mensaje: contacto ? undefined : MSG_RESTRINGIDO,
    socios: rows.map(normalizar),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

// Categorías con aliados activos (para los filtros del directorio)
router.get("/categorias", async (_req, res) => {
  const [rows] = await db.query(
    `SELECT s.categoria, COUNT(*) AS total FROM socios s
      WHERE ${SOCIO_VIGENTE_SQL} AND s.categoria IS NOT NULL AND s.categoria <> ''
      GROUP BY s.categoria ORDER BY total DESC, s.categoria`
  );
  res.json({ categorias: rows });
});

// ---------- Cliente existente pide ser Punto Aliado ----------
const solicitudSchema = z.object({
  nombre_negocio: z.string().trim().min(2, "Nombre del negocio muy corto").max(150),
  ...negocioBase,
});

router.post("/solicitud", requireAuth("CLIENTE"), validate(solicitudSchema), async (req, res) => {
  if (config.exigirVerificacionAliado && req.user.verificacion !== "VERIFICADO") {
    return res.status(403).json({ error: "Primero debes verificar tu identidad", code: "VERIFICACION_REQUERIDA" });
  }
  const [ya] = await db.query("SELECT id FROM socios WHERE usuario_id = ?", [req.user.id]);
  if (ya.length) return res.status(409).json({ error: "Ya tienes una solicitud de Punto Aliado" });

  const d = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO socios (usuario_id, nombre_negocio, slug, descripcion, categoria, ciudad, direccion, whatsapp, telefono, horario, instagram, facebook)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        req.user.id,
        d.nombre_negocio,
        await slugUnico("socios", d.nombre_negocio, 0, conn),
        d.descripcion ?? null,
        d.categoria ?? null,
        d.ciudad,
        d.direccion,
        d.whatsapp,
        d.telefono ?? null,
        d.horario ?? null,
        d.instagram ?? null,
        d.facebook ?? null,
      ]
    );
    // Pasa a rol SOCIO para entrar a su panel; queda PENDIENTE hasta que el admin apruebe
    await conn.query("UPDATE usuarios SET rol = 'SOCIO' WHERE id = ?", [req.user.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.status(201).json({ ok: true });
});

// ---------- Espacio del afiliado ----------
router.get("/me", requireAuth("SOCIO"), cargarSocio, (req, res) => {
  const s = req.socio;
  res.json({ perfil: s, motivo: s.vigente ? null : motivoInactivo(s) });
});

const perfilSchema = z.object({
  nombre_negocio: z.string().trim().min(2).max(150),
  ...negocioBase,
  logo_url: opcional(z.string().trim().url("El logo debe ser una URL válida").max(500)),
});

router.put("/me", requireAuth("SOCIO"), cargarSocio, exigirSocioVigente, validate(perfilSchema), async (req, res) => {
  const d = req.body;
  await db.query(
    `UPDATE socios SET nombre_negocio=?, descripcion=?, categoria=?, ciudad=?, direccion=?, whatsapp=?, telefono=?,
            horario=?, instagram=?, facebook=?, logo_url=? WHERE id=?`,
    [
      d.nombre_negocio,
      d.descripcion ?? null,
      d.categoria ?? null,
      d.ciudad,
      d.direccion,
      d.whatsapp,
      d.telefono ?? null,
      d.horario ?? null,
      d.instagram ?? null,
      d.facebook ?? null,
      d.logo_url ?? null,
      req.socio.id,
    ]
  );
  avisarWeb("aliados", "productos");
  res.json({ ok: true });
});

// ---------- Tienda pública de un aliado ----------
router.get("/:slug", authOptional, async (req, res) => {
  const contacto = verContacto(req);
  const [rows] = await db.query(
    `SELECT ${PUBLICO}${contacto ? `, ${CONTACTO}` : ""} FROM ${CON_USUARIO} WHERE s.slug = ? AND ${SOCIO_VIGENTE_SQL} LIMIT 1`,
    [req.params.slug]
  );
  if (!rows[0]) return res.status(404).json({ error: "Este Punto Aliado no está disponible" });
  const [productos] = await db.query(
    `SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen_url, p.destacado,
            ${DISPONIBLE_SQL} AS disponible, (p.maneja_stock = 1 AND p.stock BETWEEN 1 AND 3) AS ultimas
       FROM productos p
      WHERE p.socio_id = ? AND p.activo = 1
      ORDER BY ${DISPONIBLE_SQL} DESC, p.destacado DESC, p.created_at DESC`,
    [rows[0].id]
  );
  res.json({
    restringido: !contacto,
    mensaje: contacto ? undefined : MSG_RESTRINGIDO,
    socio: normalizar(rows[0]),
    // Nunca se publica el número de unidades: solo disponible / agotado / últimas unidades
    productos: productos.map((p) => ({ ...p, destacado: Boolean(p.destacado), disponible: Boolean(p.disponible), ultimas: Boolean(p.ultimas) })),
  });
});

export default router;
