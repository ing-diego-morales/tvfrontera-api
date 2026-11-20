// src/routes/categorias.js — NUEVO v7. Categorías de la tienda editables desde Admin > Portada
//   Público: GET /  (activas, en orden: círculos del inicio, formularios y filtros)
//   Admin:   GET /admin · POST / · PUT /orden · PUT /:id · DELETE /:id
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { avisarWeb, idValido } from "../utils.js";

const router = Router();
const admin = requireAuth("ADMIN");

// Íconos disponibles (deben existir en la web: src/lib/iconos-categorias.ts)
export const ICONOS = [
  "manzana", "cubiertos", "camisa", "celular", "wifi", "carro", "salud", "casa", "maletin", "libro", "grid",
  "cafe", "pizza", "bebida", "regalo", "joya", "zapato", "bebe", "mascota", "deporte", "herramienta",
  "flor", "computador", "musica", "camara", "farmacia", "tienda", "moto", "viaje", "belleza",
];

router.get("/", async (_req, res) => {
  const [rows] = await db.query(
    `SELECT c.id, c.nombre, c.icono,
            (SELECT COUNT(*) FROM socios s WHERE s.categoria = c.nombre AND s.estado = 'APROBADO' AND s.pagado_hasta >= CURDATE()) AS aliados
       FROM categorias c WHERE c.activo = 1 ORDER BY c.orden, c.id`
  );
  res.json({ categorias: rows });
});

router.get("/admin", admin, async (_req, res) => {
  const [rows] = await db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM socios s WHERE s.categoria = c.nombre) AS aliados FROM categorias c ORDER BY c.orden, c.id`
  );
  res.json({ categorias: rows.map((c) => ({ ...c, activo: Boolean(c.activo) })), iconos: ICONOS });
});

const schema = z.object({
  nombre: z.string().trim().min(2, "Nombre muy corto").max(80),
  icono: z.enum(ICONOS),
  activo: z.boolean().optional(),
});

router.post("/", admin, validate(schema), async (req, res) => {
  const [[{ siguiente }]] = await db.query("SELECT COALESCE(MAX(orden), 0) + 10 AS siguiente FROM categorias");
  const [r] = await db.query("INSERT INTO categorias (nombre, icono, orden, activo) VALUES (?,?,?,?)", [
    req.body.nombre,
    req.body.icono,
    siguiente,
    req.body.activo === false ? 0 : 1,
  ]);
  avisarWeb("categorias");
  res.status(201).json({ id: r.insertId });
});

router.put("/orden", admin, validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) })), async (req, res) => {
  for (const [i, id] of req.body.ids.entries()) await db.query("UPDATE categorias SET orden = ? WHERE id = ?", [(i + 1) * 10, id]);
  avisarWeb("categorias");
  res.json({ ok: true });
});

router.put("/:id", admin, validate(schema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[actual]] = await conn.query("SELECT nombre FROM categorias WHERE id = ? FOR UPDATE", [id]);
    if (!actual) {
      await conn.rollback();
      return res.status(404).json({ error: "Categoría no encontrada" });
    }
    const d = req.body;
    const campos = Object.entries({ ...d, ...(d.activo !== undefined ? { activo: d.activo ? 1 : 0 } : {}) }).filter(([, v]) => v !== undefined);
    if (campos.length) await conn.query(`UPDATE categorias SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...campos.map(([, v]) => v), id]);
    // Renombrar: los negocios de esa categoría la conservan con el nombre nuevo
    if (d.nombre && d.nombre !== actual.nombre) await conn.query("UPDATE socios SET categoria = ? WHERE categoria = ?", [d.nombre, actual.nombre]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  avisarWeb("categorias", "aliados", "productos");
  res.json({ ok: true });
});

router.delete("/:id", admin, async (req, res) => {
  const id = idValido(req.params.id) ?? 0;
  const [[c]] = await db.query("SELECT nombre, (SELECT COUNT(*) FROM socios s WHERE s.categoria = categorias.nombre) AS aliados FROM categorias WHERE id = ?", [id]);
  if (!c) return res.status(404).json({ error: "Categoría no encontrada" });
  if (c.aliados > 0) return res.status(409).json({ error: `${c.aliados} negocio(s) usan esta categoría. Ocúltala o renómbrala en lugar de borrarla.` });
  await db.query("DELETE FROM categorias WHERE id = ?", [id]);
  avisarWeb("categorias");
  res.json({ ok: true });
});

export default router;
