// src/routes/admin.js — BASE: tu archivo original. Todo exige rol ADMIN.
// Nuevo: resumen, plan del aliado, registro de mensualidades (extiende pagado_hasta),
// gestión de usuarios (rol, activo, verificación) y vista global de pedidos.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { evaluarReferido } from "../referidos.js";
import { EN_LINEA_SQL, SOCIO_DESTACADO_SQL, SOCIO_VIGENTE_SQL, adjuntarItems, avisarWeb, idValido, paginar } from "../utils.js";

const router = Router();
router.use(requireAuth("ADMIN"));

const conId = (req, res) => {
  const id = idValido(req.params.id);
  if (!id) res.status(400).json({ error: "ID inválido" });
  return id;
};

// ---------- Resumen ----------
router.get("/resumen", async (_req, res) => {
  const [[usuarios]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(rol='CLIENTE') AS clientes, SUM(rol='SOCIO') AS socios, SUM(rol='ADMIN') AS admins,
            SUM(verificacion='PENDIENTE') AS verificacion_pendiente,
            SUM(${EN_LINEA_SQL}) AS en_linea, SUM(${EN_LINEA_SQL} AND rol='SOCIO') AS aliados_en_linea FROM usuarios u`
  );
  const [[socios]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(s.estado='PENDIENTE') AS pendientes, SUM(${SOCIO_VIGENTE_SQL}) AS vigentes,
            SUM(s.estado='APROBADO' AND NOT ${SOCIO_VIGENTE_SQL}) AS vencidos, SUM(s.estado='SUSPENDIDO') AS suspendidos,
            SUM(s.estado='APROBADO' AND s.pagado_hasta BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 5 DAY)) AS por_vencer
       FROM socios s`
  );
  const [[noticias]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(estado='PUBLICADA') AS publicadas, SUM(estado='BORRADOR') AS borradores FROM noticias"
  );
  const [[pedidos]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(estado='PENDIENTE') AS pendientes, COALESCE(SUM(CASE WHEN estado<>'CANCELADO' THEN total END),0) AS monto FROM pedidos"
  );
  const [[v]] = await db.query("SELECT total FROM visitas WHERE id = 1");
  const [[suscriptores]] = await db.query("SELECT COUNT(*) AS total, COALESCE(SUM(activo), 0) AS activos FROM suscriptores");
  // SUM() devuelve string/null en MySQL: normalizamos a número
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Number(x ?? 0)]));
  res.json({ usuarios: num(usuarios), socios: num(socios), noticias: num(noticias), pedidos: num(pedidos), suscriptores: num(suscriptores), visitas: Number(v?.total ?? 0) });
});

// ---------- Aliados ----------
router.get("/socios", async (req, res) => {
  const where = [];
  const params = [];
  const estado = String(req.query.estado ?? "");
  if (estado === "VENCIDO") where.push(`s.estado = 'APROBADO' AND NOT ${SOCIO_VIGENTE_SQL}`);
  else if (["PENDIENTE", "APROBADO", "SUSPENDIDO"].includes(estado)) {
    where.push("s.estado = ?");
    params.push(estado);
  }
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(s.nombre_negocio LIKE ? OR u.email LIKE ? OR u.nombre LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const [rows] = await db.query(
    `SELECT s.*, ${SOCIO_VIGENTE_SQL} AS vigente, ${SOCIO_DESTACADO_SQL} AS destacado, u.nombre AS responsable, u.email, u.telefono AS responsable_telefono, u.cedula, u.verificacion, u.ultimo_acceso, ${EN_LINEA_SQL} AS en_linea,
            (SELECT COUNT(*) FROM productos p WHERE p.socio_id = s.id AND p.activo = 1) AS total_productos
       FROM socios s JOIN usuarios u ON u.id = s.usuario_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY FIELD(s.estado,'PENDIENTE','APROBADO','SUSPENDIDO'), s.created_at DESC`,
    params
  );
  res.json({ socios: rows.map((r) => ({ ...r, vigente: Boolean(r.vigente), destacado: Boolean(r.destacado), en_linea: Boolean(r.en_linea) })) });
});

// Aprobar / suspender / plan / POSICIONAMIENTO (prioridad 0-100 e impulso hasta una fecha)
router.patch(
  "/socios/:id",
  validate(
    z
      .object({
        estado: z.enum(["PENDIENTE", "APROBADO", "SUSPENDIDO"]),
        plan: z.enum(["BASICO", "PREMIUM"]),
        prioridad: z.number().int().min(0, "Mínimo 0").max(100, "Máximo 100"),
        destacado_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)").nullable(),
      })
      .partial()
      .refine((d) => Object.values(d).some((v) => v !== undefined), "Nada que actualizar")
  ),
  async (req, res) => {
    const id = conId(req, res);
    if (!id) return;
    const campos = Object.entries(req.body).filter(([, v]) => v !== undefined);
    const [r] = await db.query(`UPDATE socios SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [
      ...campos.map(([, v]) => v),
      id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ error: "No encontrado" });
    // Si un cliente tenía la solicitud y se aprueba, asegura el rol SOCIO
    if (req.body.estado === "APROBADO") {
      await db.query("UPDATE usuarios u JOIN socios s ON s.usuario_id = u.id SET u.rol = 'SOCIO' WHERE s.id = ? AND u.rol = 'CLIENTE'", [id]);
    }
    avisarWeb("aliados", "productos");
    res.json({ ok: true });
  }
);

// Registrar mensualidad: si está al día suma desde su vencimiento; si está vencido, desde hoy.
const pagoSchema = z.object({
  meses: z.number().int().min(1).max(24).default(1),
  monto: z.number().min(0).max(999_999_999),
  metodo: z.string().trim().max(40).optional(),
  referencia: z.string().trim().max(120).optional(),
});

router.post("/socios/:id/pagos", validate(pagoSchema), async (req, res) => {
  const id = conId(req, res);
  if (!id) return;
  const d = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[s]] = await conn.query(
      `SELECT id, GREATEST(CURDATE(), COALESCE(DATE_ADD(pagado_hasta, INTERVAL 1 DAY), CURDATE())) AS desde
         FROM socios WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!s) {
      await conn.rollback();
      return res.status(404).json({ error: "No encontrado" });
    }
    const [[{ hasta }]] = await conn.query("SELECT DATE_SUB(DATE_ADD(?, INTERVAL ? MONTH), INTERVAL 1 DAY) AS hasta", [s.desde, d.meses]);
    await conn.query(
      `INSERT INTO pagos_socios (socio_id, monto, meses, periodo_desde, periodo_hasta, metodo, referencia, registrado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, d.monto, d.meses, s.desde, hasta, d.metodo ?? null, d.referencia ?? null, req.user.id]
    );
    await conn.query("UPDATE socios SET pagado_hasta = ? WHERE id = ?", [hasta, id]);
    await conn.commit();
    avisarWeb("aliados", "productos");
    res.status(201).json({ periodo_desde: s.desde, periodo_hasta: hasta });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

router.get("/socios/:id/pagos", async (req, res) => {
  const id = conId(req, res);
  if (!id) return;
  const [rows] = await db.query(
    `SELECT ps.*, u.nombre AS registrado_por_nombre FROM pagos_socios ps
       LEFT JOIN usuarios u ON u.id = ps.registrado_por WHERE ps.socio_id = ? ORDER BY ps.created_at DESC`,
    [id]
  );
  res.json({ pagos: rows });
});

// ---------- Usuarios ----------
router.get("/usuarios", async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 20);
  const where = [];
  const params = [];
  for (const [campo, valores] of [
    ["rol", ["ADMIN", "SOCIO", "CLIENTE"]],
    ["verificacion", ["NO_VERIFICADO", "PENDIENTE", "VERIFICADO", "RECHAZADO"]],
  ]) {
    if (valores.includes(req.query[campo])) {
      where.push(`${campo} = ?`);
      params.push(req.query[campo]);
    }
  }
  if (req.query.en_linea === "1") where.push(EN_LINEA_SQL);
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(nombre LIKE ? OR email LIKE ? OR cedula LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM usuarios u ${w}`, params);
  const [rows] = await db.query(
    `SELECT id, nombre, email, telefono, cedula, rol, activo, verificacion, created_at, ultimo_acceso, ${EN_LINEA_SQL} AS en_linea
       FROM usuarios u ${w}
      ORDER BY ${EN_LINEA_SQL} DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ usuarios: rows.map((r) => ({ ...r, en_linea: Boolean(r.en_linea) })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const usuarioSchema = z
  .object({
    rol: z.enum(["ADMIN", "SOCIO", "CLIENTE"]),
    activo: z.boolean().transform((v) => (v ? 1 : 0)),
    verificacion: z.enum(["NO_VERIFICADO", "PENDIENTE", "VERIFICADO", "RECHAZADO"]),
  })
  .partial();

router.patch("/usuarios/:id", validate(usuarioSchema), async (req, res) => {
  const id = conId(req, res);
  if (!id) return;
  if (id === req.user.id && (req.body.rol !== undefined || req.body.activo === 0)) {
    return res.status(400).json({ error: "No puedes quitarte el rol de admin ni desactivarte a ti mismo" });
  }
  const campos = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  const [r] = await db.query(`UPDATE usuarios SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [
    ...campos.map(([, v]) => v),
    id,
  ]);
  if (!r.affectedRows) return res.status(404).json({ error: "No encontrado" });
  if (req.body.verificacion === "VERIFICADO") evaluarReferido(id); // requisito IDENTIDAD
  avisarWeb("aliados");
  res.json({ ok: true });
});

// ---------- Pedidos (vista global) ----------
router.get("/pedidos", async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 20);
  const estados = ["PENDIENTE", "PAGADO", "ENVIADO", "ENTREGADO", "CANCELADO"];
  const w = estados.includes(req.query.estado) ? "WHERE pe.estado = ?" : "";
  const params = w ? [req.query.estado] : [];
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM pedidos pe ${w}`, params);
  const [rows] = await db.query(
    `SELECT pe.*, u.nombre AS cliente_nombre, u.email AS cliente_email, s.nombre_negocio AS socio_nombre
       FROM pedidos pe JOIN usuarios u ON u.id = pe.usuario_id LEFT JOIN socios s ON s.id = pe.socio_id
      ${w} ORDER BY pe.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ pedidos: await adjuntarItems(rows), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export default router;
