// src/routes/referidos.js — NUEVO v6. Programa "Refiere y gana" de Televentas Fest
//   Público:  GET /programa · GET /codigo/:codigo
//   Usuario:  GET /mio
//   Admin:    /admin/... referidos (buscar por cédula, aprobar/rechazar), metas, retos (semana y fecha),
//             ganadores (entregar/anular), ranking y ajustes
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { REQUISITOS, ajustesReferidos, evaluarPremios, nombreCorto, retoDe } from "../referidos.js";
import { avisarWeb, idValido, paginar } from "../utils.js";

const router = Router();
const admin = requireAuth("ADMIN");
const hoyColombia = async () => (await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS f"))[0][0].f;

const TEXTO_REQUISITO = {
  EMAIL: "Tu invitado debe confirmar su correo y registrar su cédula.",
  IDENTIDAD: "Tu invitado debe verificar su identidad (cédula + rostro).",
  COMPRA: "Tu invitado debe hacer su primera compra y recibirla.",
};

// ---------- Público ----------
router.get("/programa", async (_req, res) => {
  const a = await ajustesReferidos();
  const hoy = await hoyColombia();
  const [metas] = await db.query(
    `SELECT m.id, m.nombre, m.descripcion, m.imagen_url, m.referidos_necesarios, m.cupo,
            (SELECT COUNT(*) FROM premios_ganados g WHERE g.meta_id = m.id AND g.estado <> 'ANULADO') AS ganadores
       FROM premios_metas m WHERE m.activo = 1 ORDER BY m.referidos_necesarios`
  );
  // Los 7 días de esta semana (lunes a domingo) con el premio que aplica cada día
  const [[{ lunes }]] = await db.query("SELECT DATE_FORMAT(CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY, '%Y-%m-%d') AS lunes");
  const semana = [];
  for (let i = 0; i < 7; i++) {
    const [[{ f }]] = await db.query("SELECT DATE_FORMAT(? + INTERVAL ? DAY, '%Y-%m-%d') AS f", [lunes, i]);
    const reto = await retoDe(f);
    const [[{ ganadores }]] = await db.query("SELECT COUNT(*) AS ganadores FROM premios_ganados WHERE tipo='RETO' AND fecha_reto = ? AND estado <> 'ANULADO'", [f]);
    semana.push({ ...reto, fecha: f, ganadores_actuales: ganadores, es_hoy: f === hoy });
  }
  // Ranking de la semana: nombres abreviados (privacidad)
  const [ranking] = await db.query(
    `SELECT u.nombre, COUNT(*) AS referidos
       FROM referidos r JOIN usuarios u ON u.id = r.referidor_id
      WHERE r.estado = 'VALIDO' AND r.validado_en >= ? AND u.activo = 1
      GROUP BY u.id, u.nombre ORDER BY referidos DESC, MIN(r.validado_en) LIMIT 10`,
    [lunes]
  );
  res.json({
    activo: a.activo,
    requisito: a.requisito,
    requisito_texto: TEXTO_REQUISITO[a.requisito],
    hoy,
    reto_hoy: semana.find((d) => d.es_hoy) ?? null,
    semana,
    metas: metas.map((m) => ({ ...m, agotado: m.cupo !== null && m.ganadores >= m.cupo })),
    ranking: ranking.map((r) => ({ nombre: nombreCorto(r.nombre), referidos: r.referidos })),
  });
});

// Para mostrar "Te invitó Juan P." en el registro
router.get("/codigo/:codigo", async (req, res) => {
  const [[u]] = await db.query("SELECT nombre FROM usuarios WHERE codigo_ref = ? AND activo = 1 AND rol <> 'ADMIN'", [String(req.params.codigo).toUpperCase().slice(0, 20)]);
  if (!u) return res.status(404).json({ error: "Código no válido" });
  res.json({ nombre: nombreCorto(u.nombre) });
});

// ---------- Usuario ----------
router.get("/mio", requireAuth(), async (req, res) => {
  const hoy = await hoyColombia();
  const [lista] = await db.query(
    `SELECT u.nombre, r.estado, r.sospechoso, r.created_at, r.validado_en
       FROM referidos r JOIN usuarios u ON u.id = r.referido_id
      WHERE r.referidor_id = ? ORDER BY r.created_at DESC LIMIT 200`,
    [req.user.id]
  );
  const [premios] = await db.query(
    "SELECT id, tipo, premio, posicion, estado, DATE_FORMAT(fecha_reto, '%Y-%m-%d') AS fecha_reto, created_at FROM premios_ganados WHERE usuario_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  const validos = lista.filter((r) => r.estado === "VALIDO");
  const a = await ajustesReferidos();
  res.json({
    codigo: req.user.codigo_ref,
    enlace: `${config.appUrl}/registro?ref=${req.user.codigo_ref}`,
    requisito_texto: TEXTO_REQUISITO[a.requisito],
    total_validos: validos.length,
    hoy_validos: validos.filter((r) => String(r.validado_en ?? "").length && new Date(r.validado_en).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) === hoy).length,
    pendientes: lista.filter((r) => r.estado === "PENDIENTE").length,
    // Nombres abreviados: el referidor no ve datos personales de sus invitados
    referidos: lista.map((r) => ({
      nombre: nombreCorto(r.nombre),
      estado: r.estado,
      en_revision: Boolean(r.sospechoso) && r.estado === "PENDIENTE",
      fecha: r.created_at,
    })),
    premios,
  });
});

// ---------- Admin ----------
router.get("/admin/resumen", admin, async (_req, res) => {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(estado='VALIDO'),0) AS validos, COALESCE(SUM(estado='PENDIENTE'),0) AS pendientes,
            COALESCE(SUM(estado='PENDIENTE' AND sospechoso=1),0) AS por_revisar, COALESCE(SUM(estado='RECHAZADO'),0) AS rechazados,
            COALESCE(SUM(estado='VALIDO' AND DATE(validado_en)=CURDATE()),0) AS validos_hoy
       FROM referidos`
  );
  const [[g]] = await db.query("SELECT COUNT(*) AS total, COALESCE(SUM(estado='PENDIENTE'),0) AS por_entregar FROM premios_ganados");
  res.json({ referidos: r, premios: g, ajustes: await ajustesReferidos() });
});

// Lista con búsqueda por CÉDULA, correo o nombre (de quien invita o del invitado)
router.get("/admin/lista", admin, async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 25);
  const where = [];
  const params = [];
  if (["PENDIENTE", "VALIDO", "RECHAZADO"].includes(req.query.estado)) {
    where.push("r.estado = ?");
    params.push(req.query.estado);
  }
  if (req.query.sospechoso === "1") where.push("r.sospechoso = 1 AND r.estado = 'PENDIENTE'");
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(a.cedula = ? OR b.cedula = ? OR a.email LIKE ? OR b.email LIKE ? OR a.nombre LIKE ? OR b.nombre LIKE ? OR a.codigo_ref = ?)");
    params.push(q, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q.toUpperCase());
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const desde = "FROM referidos r JOIN usuarios a ON a.id = r.referidor_id JOIN usuarios b ON b.id = r.referido_id";
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${desde} ${w}`, params);
  const [rows] = await db.query(
    `SELECT r.id, r.estado, r.sospechoso, r.motivo, r.created_at, r.validado_en,
            a.id AS referidor_id, a.nombre AS referidor_nombre, a.email AS referidor_email, a.cedula AS referidor_cedula, a.codigo_ref,
            b.id AS referido_id, b.nombre AS referido_nombre, b.email AS referido_email, b.cedula AS referido_cedula,
            b.email_verificado IS NOT NULL AS referido_correo_ok, b.verificacion AS referido_verificacion, b.registro_ip AS referido_ip
       ${desde} ${w} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({
    referidos: rows.map((x) => ({ ...x, sospechoso: Boolean(x.sospechoso), referido_correo_ok: Boolean(x.referido_correo_ok) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.patch(
  "/admin/:id",
  admin,
  validate(z.object({ estado: z.enum(["VALIDO", "RECHAZADO", "PENDIENTE"]), motivo: z.string().trim().max(200).optional() })),
  async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });
    const [[r]] = await db.query("SELECT referidor_id FROM referidos WHERE id = ?", [id]);
    if (!r) return res.status(404).json({ error: "Referido no encontrado" });
    const valido = req.body.estado === "VALIDO";
    await db.query(
      `UPDATE referidos SET estado = ?, sospechoso = IF(? = 'PENDIENTE', sospechoso, 0),
              motivo = COALESCE(?, motivo), validado_en = ${valido ? "COALESCE(validado_en, NOW())" : "NULL"} WHERE id = ?`,
      [req.body.estado, req.body.estado, req.body.motivo ?? null, id]
    );
    if (valido) await evaluarPremios(r.referidor_id);
    res.json({ ok: true });
  }
);

// --- Metas (premios por cantidad acumulada) ---
const opcional = (s) => s.nullable().optional().or(z.literal("").transform(() => null));
const metaSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  descripcion: opcional(z.string().trim().max(500)),
  imagen_url: opcional(z.string().trim().max(500).refine((v) => /^(https?:\/\/|\/)/.test(v), "URL inválida")),
  referidos_necesarios: z.number().int().min(1).max(10000),
  cupo: z.number().int().min(1).max(100000).nullable().optional(),
  activo: z.boolean().optional(),
});

router.get("/admin/metas", admin, async (_req, res) => {
  const [rows] = await db.query(
    `SELECT m.*, (SELECT COUNT(*) FROM premios_ganados g WHERE g.meta_id = m.id AND g.estado <> 'ANULADO') AS ganadores
       FROM premios_metas m ORDER BY m.referidos_necesarios`
  );
  res.json({ metas: rows.map((m) => ({ ...m, activo: Boolean(m.activo) })) });
});
router.post("/admin/metas", admin, validate(metaSchema), async (req, res) => {
  const d = req.body;
  const [r] = await db.query("INSERT INTO premios_metas (nombre, descripcion, imagen_url, referidos_necesarios, cupo, activo) VALUES (?,?,?,?,?,?)", [
    d.nombre,
    d.descripcion ?? null,
    d.imagen_url ?? null,
    d.referidos_necesarios,
    d.cupo ?? null,
    d.activo === false ? 0 : 1,
  ]);
  avisarWeb("referidos");
  res.status(201).json({ id: r.insertId });
});
router.put("/admin/metas/:id", admin, validate(metaSchema.partial()), async (req, res) => {
  const campos = Object.entries({ ...req.body, ...(req.body.activo !== undefined ? { activo: req.body.activo ? 1 : 0 } : {}) }).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  await db.query(`UPDATE premios_metas SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...campos.map(([, v]) => v), idValido(req.params.id) ?? 0]);
  avisarWeb("referidos");
  res.json({ ok: true });
});
router.delete("/admin/metas/:id", admin, async (req, res) => {
  await db.query("DELETE FROM premios_metas WHERE id = ?", [idValido(req.params.id) ?? 0]);
  avisarWeb("referidos");
  res.json({ ok: true });
});

// --- Retos: predeterminado Lun-Dom + fechas puntuales ---
const retoSchema = z.object({
  activo: z.boolean(),
  premio: z.string().trim().min(2, "Escribe el premio").max(200),
  descripcion: opcional(z.string().trim().max(500)),
  referidos_necesarios: z.number().int().min(1).max(1000),
  ganadores: z.number().int().min(1).max(10000),
});

router.get("/admin/retos", admin, async (_req, res) => {
  const [semana] = await db.query("SELECT * FROM retos_semana ORDER BY dia");
  const [fechas] = await db.query(
    `SELECT DATE_FORMAT(f.fecha, '%Y-%m-%d') AS fecha, f.activo, f.premio, f.descripcion, f.referidos_necesarios, f.ganadores,
            (SELECT COUNT(*) FROM premios_ganados g WHERE g.tipo='RETO' AND g.fecha_reto = f.fecha AND g.estado <> 'ANULADO') AS ganadores_actuales
       FROM retos_fecha f WHERE f.fecha >= CURDATE() - INTERVAL 30 DAY ORDER BY f.fecha`
  );
  res.json({
    semana: semana.map((d) => ({ ...d, activo: Boolean(d.activo) })),
    fechas: fechas.map((d) => ({ ...d, activo: Boolean(d.activo) })),
    hoy: await hoyColombia(),
  });
});
router.put("/admin/retos/semana/:dia", admin, validate(retoSchema), async (req, res) => {
  const dia = Number(req.params.dia);
  if (!(dia >= 1 && dia <= 7)) return res.status(400).json({ error: "Día inválido" });
  const d = req.body;
  await db.query(
    `INSERT INTO retos_semana (dia, activo, premio, descripcion, referidos_necesarios, ganadores) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE activo=VALUES(activo), premio=VALUES(premio), descripcion=VALUES(descripcion),
                             referidos_necesarios=VALUES(referidos_necesarios), ganadores=VALUES(ganadores)`,
    [dia, d.activo ? 1 : 0, d.premio, d.descripcion ?? null, d.referidos_necesarios, d.ganadores]
  );
  avisarWeb("referidos");
  res.json({ ok: true });
});
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f);
router.put("/admin/retos/fecha/:fecha", admin, validate(retoSchema), async (req, res) => {
  if (!fechaValida(req.params.fecha)) return res.status(400).json({ error: "Fecha inválida" });
  const d = req.body;
  await db.query(
    `INSERT INTO retos_fecha (fecha, activo, premio, descripcion, referidos_necesarios, ganadores) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE activo=VALUES(activo), premio=VALUES(premio), descripcion=VALUES(descripcion),
                             referidos_necesarios=VALUES(referidos_necesarios), ganadores=VALUES(ganadores)`,
    [req.params.fecha, d.activo ? 1 : 0, d.premio, d.descripcion ?? null, d.referidos_necesarios, d.ganadores]
  );
  avisarWeb("referidos");
  res.json({ ok: true });
});
router.delete("/admin/retos/fecha/:fecha", admin, async (req, res) => {
  if (!fechaValida(req.params.fecha)) return res.status(400).json({ error: "Fecha inválida" });
  await db.query("DELETE FROM retos_fecha WHERE fecha = ?", [req.params.fecha]);
  avisarWeb("referidos");
  res.json({ ok: true });
});

// --- Ganadores ---
router.get("/admin/ganadores", admin, async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 25);
  const where = [];
  const params = [];
  if (["PENDIENTE", "ENTREGADO", "ANULADO"].includes(req.query.estado)) {
    where.push("g.estado = ?");
    params.push(req.query.estado);
  }
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(u.cedula = ? OR u.email LIKE ? OR u.nombre LIKE ?)");
    params.push(q, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM premios_ganados g JOIN usuarios u ON u.id = g.usuario_id ${w}`, params);
  const [rows] = await db.query(
    `SELECT g.id, g.tipo, g.premio, g.posicion, g.estado, g.notas, g.created_at, g.entregado_en, DATE_FORMAT(g.fecha_reto, '%Y-%m-%d') AS fecha_reto,
            u.id AS usuario_id, u.nombre, u.email, u.cedula, u.telefono,
            (SELECT COUNT(*) FROM referidos r WHERE r.referidor_id = u.id AND r.estado = 'VALIDO') AS total_referidos
       FROM premios_ganados g JOIN usuarios u ON u.id = g.usuario_id ${w}
      ORDER BY FIELD(g.estado, 'PENDIENTE', 'ENTREGADO', 'ANULADO'), g.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ ganadores: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});
router.patch(
  "/admin/ganadores/:id",
  admin,
  validate(z.object({ estado: z.enum(["PENDIENTE", "ENTREGADO", "ANULADO"]), notas: z.string().trim().max(300).optional() })),
  async (req, res) => {
    await db.query(
      `UPDATE premios_ganados SET estado = ?, notas = COALESCE(?, notas), entregado_en = ${req.body.estado === "ENTREGADO" ? "NOW()" : "NULL"} WHERE id = ?`,
      [req.body.estado, req.body.notas ?? null, idValido(req.params.id) ?? 0]
    );
    avisarWeb("referidos");
    res.json({ ok: true });
  }
);

// --- Ajustes del programa ---
router.put(
  "/admin/ajustes",
  admin,
  validate(z.object({ activo: z.boolean().optional(), requisito: z.enum(REQUISITOS).optional() })),
  async (req, res) => {
    if (req.body.activo !== undefined)
      await db.query("INSERT INTO ajustes (clave, valor) VALUES ('referidos_activo', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.activo ? "1" : "0"]);
    if (req.body.requisito)
      await db.query("INSERT INTO ajustes (clave, valor) VALUES ('referidos_requisito', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.requisito]);
    avisarWeb("referidos");
    res.json({ ok: true });
  }
);

export default router;
