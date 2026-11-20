// src/routes/preguntas.js — NUEVO v8. Preguntas frecuentes (FAQ) editables desde Admin > Preguntas
//   Público: GET /  (activas, en orden, agrupables por tema)
//   Admin:   GET /admin · POST / · PUT /orden · PUT /:id · DELETE /:id
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { avisarWeb, idValido } from "../utils.js";

const router = Router();
const admin = requireAuth("ADMIN");

router.get("/", async (_req, res) => {
  const [rows] = await db.query("SELECT id, tema, pregunta, respuesta FROM preguntas_frecuentes WHERE activo = 1 ORDER BY orden, id");
  res.json({ preguntas: rows });
});

router.get("/admin", admin, async (_req, res) => {
  const [rows] = await db.query("SELECT * FROM preguntas_frecuentes ORDER BY orden, id");
  res.json({ preguntas: rows.map((p) => ({ ...p, activo: Boolean(p.activo) })) });
});

const schema = z.object({
  tema: z.string().trim().min(2, "Escribe el tema").max(60),
  pregunta: z.string().trim().min(5, "La pregunta es muy corta").max(200),
  respuesta: z.string().trim().min(5, "La respuesta es muy corta").max(4000),
  activo: z.boolean().optional(),
});

router.post("/", admin, validate(schema), async (req, res) => {
  const [[{ siguiente }]] = await db.query("SELECT COALESCE(MAX(orden), 0) + 10 AS siguiente FROM preguntas_frecuentes");
  const d = req.body;
  const [r] = await db.query("INSERT INTO preguntas_frecuentes (tema, pregunta, respuesta, orden, activo) VALUES (?,?,?,?,?)", [
    d.tema,
    d.pregunta,
    d.respuesta,
    siguiente,
    d.activo === false ? 0 : 1,
  ]);
  avisarWeb("preguntas");
  res.status(201).json({ id: r.insertId });
});

router.put("/orden", admin, validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) })), async (req, res) => {
  for (const [i, id] of req.body.ids.entries()) await db.query("UPDATE preguntas_frecuentes SET orden = ? WHERE id = ?", [(i + 1) * 10, id]);
  avisarWeb("preguntas");
  res.json({ ok: true });
});

router.put("/:id", admin, validate(schema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const d = { ...req.body, ...(req.body.activo !== undefined ? { activo: req.body.activo ? 1 : 0 } : {}) };
  const campos = Object.entries(d).filter(([k, v]) => v !== undefined && ["tema", "pregunta", "respuesta", "activo"].includes(k));
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  const [r] = await db.query(`UPDATE preguntas_frecuentes SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...campos.map(([, v]) => v), id]);
  if (!r.affectedRows) return res.status(404).json({ error: "Pregunta no encontrada" });
  avisarWeb("preguntas");
  res.json({ ok: true });
});

router.delete("/:id", admin, async (req, res) => {
  const [r] = await db.query("DELETE FROM preguntas_frecuentes WHERE id = ?", [idValido(req.params.id) ?? 0]);
  if (!r.affectedRows) return res.status(404).json({ error: "Pregunta no encontrada" });
  avisarWeb("preguntas");
  res.json({ ok: true });
});

export default router;
