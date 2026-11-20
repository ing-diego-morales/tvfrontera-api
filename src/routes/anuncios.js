// src/routes/anuncios.js — NUEVO. La cinta de avisos bajo el menú, editable desde Admin.
//   Público: GET /api/anuncios -> { activo, titulo, anuncios: [...] } (solo vigentes y en orden)
//   Admin:   GET /admin · POST / · PUT /:id · DELETE /:id · PUT /ajustes { activo, titulo }
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { avisarWeb, idValido } from "../utils.js";

const router = Router();

async function ajustes() {
  const [rows] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('avisos_activos','avisos_titulo')");
  const m = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  return { activo: m.avisos_activos !== "0", titulo: m.avisos_titulo || "Avisos" };
}

// ---------- Público ----------
router.get("/", async (_req, res) => {
  const a = await ajustes();
  if (!a.activo) return res.json({ ...a, anuncios: [] });
  const [anuncios] = await db.query(
    `SELECT id, texto, enlace FROM anuncios
      WHERE activo = 1 AND (desde IS NULL OR desde <= NOW()) AND (hasta IS NULL OR hasta >= NOW())
      ORDER BY orden, id LIMIT 20`
  );
  res.json({ ...a, anuncios });
});

// ---------- Admin ----------
router.get("/admin", requireAuth("ADMIN"), async (_req, res) => {
  // Fechas como texto en hora local ("2026-11-20 10:00"): evita corrimientos de zona horaria en el formulario
  const [anuncios] = await db.query(
    `SELECT id, texto, enlace, activo, orden, DATE_FORMAT(desde, '%Y-%m-%d %H:%i') AS desde, DATE_FORMAT(hasta, '%Y-%m-%d %H:%i') AS hasta
       FROM anuncios ORDER BY orden, id`
  );
  res.json({ ...(await ajustes()), anuncios });
});

// Enlace interno (/ruta) o https://. Nunca javascript: ni otros esquemas.
const enlace = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^\/(?!\/)[\w\-./?=&%#]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "El enlace debe empezar por / o por https://")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, "Fecha inválida")
  .transform((v) => v.replace("T", " "))
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const anuncioSchema = z.object({
  texto: z.string().trim().min(3, "Escribe el aviso").max(200, "Máximo 200 caracteres"),
  enlace,
  activo: z.boolean().transform((v) => (v ? 1 : 0)).optional(),
  orden: z.number().int().min(0).max(999).optional(),
  desde: fecha,
  hasta: fecha,
});

router.post("/", requireAuth("ADMIN"), validate(anuncioSchema), async (req, res) => {
  const d = req.body;
  const [r] = await db.query("INSERT INTO anuncios (texto, enlace, activo, orden, desde, hasta) VALUES (?,?,?,?,?,?)", [
    d.texto,
    d.enlace ?? null,
    d.activo ?? 1,
    d.orden ?? 0,
    d.desde ?? null,
    d.hasta ?? null,
  ]);
  avisarWeb("avisos");
  res.status(201).json({ id: r.insertId });
});

router.put("/ajustes", requireAuth("ADMIN"), validate(z.object({ activo: z.boolean(), titulo: z.string().trim().min(1).max(30).optional() })), async (req, res) => {
  await db.query("INSERT INTO ajustes (clave, valor) VALUES ('avisos_activos', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.activo ? "1" : "0"]);
  if (req.body.titulo) {
    await db.query("INSERT INTO ajustes (clave, valor) VALUES ('avisos_titulo', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.titulo]);
  }
  avisarWeb("avisos");
  res.json({ ok: true });
});

router.put("/:id", requireAuth("ADMIN"), validate(anuncioSchema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const campos = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  const [r] = await db.query(`UPDATE anuncios SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...campos.map(([, v]) => v), id]);
  if (!r.affectedRows) return res.status(404).json({ error: "Aviso no encontrado" });
  avisarWeb("avisos");
  res.json({ ok: true });
});

router.delete("/:id", requireAuth("ADMIN"), async (req, res) => {
  await db.query("DELETE FROM anuncios WHERE id = ?", [idValido(req.params.id) ?? 0]);
  avisarWeb("avisos");
  res.json({ ok: true });
});

export default router;
