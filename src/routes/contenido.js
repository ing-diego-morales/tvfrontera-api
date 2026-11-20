// src/routes/contenido.js — NUEVO v5. Contenido del sitio editable desde Admin (sin tocar código):
//   /api/secciones     -> orden y visibilidad del inicio + bloques promocionales (sorteo, campañas)
//   /api/programacion  -> parrilla del canal
//   /api/sitio         -> textos del sitio (ej. historia de "Nosotros")
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { avisarWeb, idValido } from "../utils.js";

const admin = requireAuth("ADMIN");

// Enlace interno (/ruta) o https://. Nunca javascript: ni otros esquemas.
const enlace = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^\/(?!\/)[\w\-./?=&%#]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "El enlace debe empezar por / o por https://");
const imagen = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)[\w\-./]+$/.test(v) || /^https?:\/\/[^\s]+$/.test(v), "La imagen debe ser una URL (https://...) o una ruta del sitio");
const opcional = (s) => s.nullable().optional().or(z.literal("").transform(() => null));
const fecha = opcional(
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, "Fecha inválida")
    .transform((v) => v.replace("T", " "))
);
const fmt = (col) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i') AS ${col}`;

// =====================================================================
// SECCIONES DEL INICIO
// =====================================================================
export const secciones = Router();

const leerDatos = (r) => {
  let datos = null;
  try {
    datos = r.datos ? JSON.parse(r.datos) : null;
  } catch {
    datos = null;
  }
  return { ...r, activo: Boolean(r.activo), datos };
};

// Público: solo las visibles y dentro de sus fechas, en orden
secciones.get("/", async (_req, res) => {
  const [rows] = await db.query(
    `SELECT id, clave, tipo, titulo, orden, datos, ${fmt("desde")}, ${fmt("hasta")} FROM secciones
      WHERE activo = 1 AND (desde IS NULL OR desde <= NOW()) AND (hasta IS NULL OR hasta >= NOW())
      ORDER BY orden, id`
  );
  res.json({ secciones: rows.map(leerDatos) });
});

secciones.get("/admin", admin, async (_req, res) => {
  const [rows] = await db.query(`SELECT id, clave, tipo, titulo, activo, orden, datos, ${fmt("desde")}, ${fmt("hasta")} FROM secciones ORDER BY orden, id`);
  res.json({ secciones: rows.map(leerDatos) });
});

const datosPromo = z.object({
  etiqueta: opcional(z.string().trim().max(40)),
  subtitulo: opcional(z.string().trim().max(200)),
  texto: opcional(z.string().trim().max(2000)),
  imagen_url: opcional(imagen),
  boton_texto: opcional(z.string().trim().max(40)),
  boton_enlace: opcional(enlace),
  estilo: z.enum(["naranja", "indigo", "claro", "amarillo"]).default("naranja"),
  fecha_evento: fecha, // muestra cuenta regresiva (ej. día del sorteo)
});

const promoSchema = z.object({
  titulo: z.string().trim().min(3, "Escribe un título").max(150),
  activo: z.boolean().optional(),
  datos: datosPromo,
  desde: fecha,
  hasta: fecha,
});

secciones.post("/", admin, validate(promoSchema), async (req, res) => {
  const d = req.body;
  const [[{ siguiente }]] = await db.query("SELECT COALESCE(MAX(orden), 0) + 10 AS siguiente FROM secciones");
  const [r] = await db.query("INSERT INTO secciones (tipo, titulo, activo, orden, datos, desde, hasta) VALUES ('PROMO',?,?,?,?,?,?)", [
    d.titulo,
    d.activo === false ? 0 : 1,
    siguiente,
    JSON.stringify(d.datos),
    d.desde ?? null,
    d.hasta ?? null,
  ]);
  avisarWeb("secciones");
  res.status(201).json({ id: r.insertId });
});

// Reordenar: lista de ids en el orden deseado
secciones.put("/orden", admin, validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [i, id] of req.body.ids.entries()) await conn.query("UPDATE secciones SET orden = ? WHERE id = ?", [(i + 1) * 10, id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  avisarWeb("secciones");
  res.json({ ok: true });
});

secciones.put("/:id", admin, validate(promoSchema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const [[s]] = await db.query("SELECT tipo FROM secciones WHERE id = ?", [id]);
  if (!s) return res.status(404).json({ error: "Sección no encontrada" });
  const d = req.body;
  const campos = [];
  const valores = [];
  if (d.activo !== undefined) campos.push("activo = ?") && valores.push(d.activo ? 1 : 0);
  if (d.titulo !== undefined) campos.push("titulo = ?") && valores.push(d.titulo);
  // Las secciones del SISTEMA solo se muestran/ocultan/renombran; el contenido es de los PROMO
  if (s.tipo === "PROMO") {
    if (d.datos !== undefined) campos.push("datos = ?") && valores.push(JSON.stringify(d.datos));
    if (d.desde !== undefined) campos.push("desde = ?") && valores.push(d.desde);
    if (d.hasta !== undefined) campos.push("hasta = ?") && valores.push(d.hasta);
  }
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  await db.query(`UPDATE secciones SET ${campos.join(", ")} WHERE id = ?`, [...valores, id]);
  avisarWeb("secciones");
  res.json({ ok: true });
});

secciones.delete("/:id", admin, async (req, res) => {
  const [r] = await db.query("DELETE FROM secciones WHERE id = ? AND tipo = 'PROMO'", [idValido(req.params.id) ?? 0]);
  if (!r.affectedRows) return res.status(400).json({ error: "Solo se pueden borrar bloques promocionales (las secciones fijas se ocultan)" });
  avisarWeb("secciones");
  res.json({ ok: true });
});

// =====================================================================
// PROGRAMACIÓN DEL CANAL
// =====================================================================
export const programacion = Router();

const COLS_PROG = "id, titulo, descripcion, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin, dias, activo";

programacion.get("/", async (_req, res) => {
  const [rows] = await db.query(`SELECT ${COLS_PROG} FROM programacion WHERE activo = 1 ORDER BY hora_inicio, id`);
  res.json({ programas: rows.map((r) => ({ ...r, activo: Boolean(r.activo) })) });
});

programacion.get("/admin", admin, async (_req, res) => {
  const [rows] = await db.query(`SELECT ${COLS_PROG} FROM programacion ORDER BY hora_inicio, id`);
  res.json({ programas: rows.map((r) => ({ ...r, activo: Boolean(r.activo) })) });
});

const hora = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");
const programaSchema = z.object({
  titulo: z.string().trim().min(2, "Escribe el nombre del programa").max(120),
  descripcion: opcional(z.string().trim().max(300)),
  hora_inicio: hora,
  hora_fin: opcional(hora),
  dias: z
    .string()
    .regex(/^[1-7]{1,7}$/, "Elige al menos un día")
    .transform((v) => [...new Set(v.split(""))].sort().join("")),
  activo: z.boolean().optional(),
});

programacion.post("/", admin, validate(programaSchema), async (req, res) => {
  const d = req.body;
  const [r] = await db.query("INSERT INTO programacion (titulo, descripcion, hora_inicio, hora_fin, dias, activo) VALUES (?,?,?,?,?,?)", [
    d.titulo,
    d.descripcion ?? null,
    d.hora_inicio,
    d.hora_fin ?? null,
    d.dias,
    d.activo === false ? 0 : 1,
  ]);
  avisarWeb("programacion");
  res.status(201).json({ id: r.insertId });
});

programacion.put("/:id", admin, validate(programaSchema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const d = { ...req.body, ...(req.body.activo !== undefined ? { activo: req.body.activo ? 1 : 0 } : {}) };
  const campos = Object.entries(d).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  const [r] = await db.query(`UPDATE programacion SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...campos.map(([, v]) => v), id]);
  if (!r.affectedRows) return res.status(404).json({ error: "Programa no encontrado" });
  avisarWeb("programacion");
  res.json({ ok: true });
});

programacion.delete("/:id", admin, async (req, res) => {
  await db.query("DELETE FROM programacion WHERE id = ?", [idValido(req.params.id) ?? 0]);
  avisarWeb("programacion");
  res.json({ ok: true });
});

// =====================================================================
// TEXTOS DEL SITIO (claves permitidas, nada arbitrario)
// =====================================================================
export const sitio = Router();
const CLAVES_SITIO = ["nosotros_historia"];

sitio.get("/", async (_req, res) => {
  const [rows] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN (?)", [CLAVES_SITIO]);
  res.json({ textos: Object.fromEntries(rows.map((r) => [r.clave, r.valor])) });
});

sitio.put(
  "/",
  admin,
  validate(z.object({ nosotros_historia: z.string().trim().min(20, "Escribe al menos un párrafo").max(5000) }).partial()),
  async (req, res) => {
    for (const [clave, valor] of Object.entries(req.body)) {
      if (!CLAVES_SITIO.includes(clave) || valor === undefined) continue;
      await db.query("INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [clave, valor]);
    }
    avisarWeb("sitio");
    res.json({ ok: true });
  }
);
