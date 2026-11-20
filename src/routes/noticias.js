// src/routes/noticias.js — NUEVO. Público: solo PUBLICADAS. Admin: CRUD.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { estadoFacebook, sincronizarFacebook } from "../facebook.js";
import { validate } from "../middleware/errors.js";
import { CATEGORIAS_NOTICIA, avisarWeb, idValido, paginar, slugUnico } from "../utils.js";

const router = Router();

const CAMPOS =
  "n.id, n.slug, n.titulo, n.resumen, n.categoria, n.imagen_url, n.video_url, n.destacada, n.estado, n.publicada_en, n.updated_at, n.fuente, n.fuente_url, u.nombre AS autor";

async function listar(req, res, soloPublicadas) {
  const { page, limit, offset } = paginar(req.query, 9);
  const where = [];
  const params = [];
  if (soloPublicadas) where.push("n.estado = 'PUBLICADA'");
  else if (["BORRADOR", "PUBLICADA"].includes(req.query.estado)) {
    where.push("n.estado = ?");
    params.push(req.query.estado);
  }
  if (CATEGORIAS_NOTICIA.includes(req.query.categoria)) {
    where.push("n.categoria = ?");
    params.push(req.query.categoria);
  }
  if (req.query.destacada === "1") where.push("n.destacada = 1");
  if (req.query.con_video === "1") where.push("n.video_url IS NOT NULL AND n.video_url <> ''");
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(n.titulo LIKE ? OR n.resumen LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM noticias n ${w}`, params);
  const [rows] = await db.query(
    `SELECT ${CAMPOS} FROM noticias n LEFT JOIN usuarios u ON u.id = n.autor_id ${w}
      -- Siempre lo más reciente primero (id desempata noticias publicadas en el mismo segundo)
      ORDER BY ${soloPublicadas ? "n.publicada_en" : "n.updated_at"} DESC, n.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ noticias: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}

const urlOpcional = z.string().trim().url("URL inválida").max(500).nullable().or(z.literal("").transform(() => null));

const noticiaSchema = z.object({
  titulo: z.string().trim().min(5, "Título muy corto").max(200),
  resumen: z.string().trim().max(400).nullable().optional(),
  contenido: z.string().max(200_000).nullable().optional(),
  categoria: z.enum(CATEGORIAS_NOTICIA),
  imagen_url: urlOpcional.optional(),
  video_url: urlOpcional.optional(),
  destacada: z.boolean().transform((v) => (v ? 1 : 0)).optional(),
  estado: z.enum(["BORRADOR", "PUBLICADA"]),
});
// Al crear, si no envían estado queda en BORRADOR. Al editar (partial) no se toca lo que no venga.
const crearNoticiaSchema = noticiaSchema.extend({ estado: z.enum(["BORRADOR", "PUBLICADA"]).default("BORRADOR") });

// ---------- Público ----------
router.get("/", (req, res) => listar(req, res, true));

// ---------- Admin (antes de /:slug) ----------
router.get("/admin/todas", requireAuth("ADMIN"), (req, res) => listar(req, res, false));

// --- Facebook: estado e importación manual ---
router.get("/admin/facebook", requireAuth("ADMIN"), async (_req, res) => {
  const [rows] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('facebook_publicar','facebook_categoria')");
  const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM noticias WHERE fuente = 'FACEBOOK'");
  res.json({ ...estadoFacebook, total, ajustes: Object.fromEntries(rows.map((r) => [r.clave, r.valor])) });
});
router.post("/admin/facebook/sincronizar", requireAuth("ADMIN"), async (_req, res) => {
  const r = await sincronizarFacebook();
  res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
});
router.put(
  "/admin/facebook/ajustes",
  requireAuth("ADMIN"),
  validate(z.object({ publicar: z.boolean().optional(), categoria: z.enum(CATEGORIAS_NOTICIA).optional() })),
  async (req, res) => {
    if (req.body.publicar !== undefined)
      await db.query("INSERT INTO ajustes (clave, valor) VALUES ('facebook_publicar', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.publicar ? "1" : "0"]);
    if (req.body.categoria)
      await db.query("INSERT INTO ajustes (clave, valor) VALUES ('facebook_categoria', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [req.body.categoria]);
    res.json({ ok: true });
  }
);

router.get("/admin/:id", requireAuth("ADMIN"), async (req, res) => {
  const [rows] = await db.query(`SELECT ${CAMPOS}, n.contenido FROM noticias n LEFT JOIN usuarios u ON u.id = n.autor_id WHERE n.id = ?`, [
    idValido(req.params.id) ?? 0,
  ]);
  if (!rows[0]) return res.status(404).json({ error: "Noticia no encontrada" });
  res.json({ noticia: rows[0] });
});

router.post("/", requireAuth("ADMIN"), validate(crearNoticiaSchema), async (req, res) => {
  const d = req.body;
  const [r] = await db.query(
    `INSERT INTO noticias (slug, titulo, resumen, contenido, categoria, imagen_url, video_url, destacada, estado, autor_id, publicada_en)
     VALUES (?,?,?,?,?,?,?,?,?,?, ${d.estado === "PUBLICADA" ? "NOW()" : "NULL"})`,
    [await slugUnico("noticias", d.titulo), d.titulo, d.resumen ?? null, d.contenido ?? null, d.categoria, d.imagen_url ?? null, d.video_url ?? null, d.destacada ?? 0, d.estado, req.user.id]
  );
  avisarWeb("noticias");
  res.status(201).json({ id: r.insertId });
});

router.put("/:id", requireAuth("ADMIN"), validate(noticiaSchema.partial()), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const campos = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  const [r] = await db.query(
    `UPDATE noticias SET ${campos.map(([k]) => `${k} = ?`).join(", ")},
            publicada_en = IF(estado = 'PUBLICADA' AND publicada_en IS NULL, NOW(), publicada_en)
      WHERE id = ?`,
    [...campos.map(([, v]) => v), id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: "Noticia no encontrada" });
  avisarWeb("noticias");
  res.json({ ok: true });
});

router.delete("/:id", requireAuth("ADMIN"), async (req, res) => {
  await db.query("DELETE FROM noticias WHERE id = ?", [idValido(req.params.id) ?? 0]);
  avisarWeb("noticias");
  res.json({ ok: true });
});

// ---------- Público: detalle ----------
router.get("/:slug", async (req, res) => {
  const [rows] = await db.query(
    `SELECT ${CAMPOS}, n.contenido FROM noticias n LEFT JOIN usuarios u ON u.id = n.autor_id
      WHERE n.slug = ? AND n.estado = 'PUBLICADA'`,
    [req.params.slug]
  );
  if (!rows[0]) return res.status(404).json({ error: "Noticia no encontrada" });
  res.json({ noticia: rows[0] });
});

export default router;
