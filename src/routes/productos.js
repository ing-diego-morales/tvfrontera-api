// src/routes/productos.js — BASE: tu archivo original.
// v2: solo productos de aliados al día; filtro por aliado (?socio=slug); GET /mios para el panel;
//     publicar/editar/borrar exige mensualidad activa.
// v3: catálogo con POSICIONAMIENTO y variedad, productos "estrella" (destacado) con cupo por plan,
//     ?destacados=1 para el inicio y el nombre del negocio visible (ya es público en el directorio).
// v4: DISPONIBLE / AGOTADO (sin números, ej. hamburguesas) y control de unidades OPCIONAL.
//     Al público nunca se le muestra el stock. Los productos son SOLO del aliado: el admin no los edita
//     (para retirar a un aliado se suspende desde Admin > Puntos Aliados).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { cargarSocio, exigirSocioVigente } from "../middleware/socio.js";
import { DISPONIBLE_SQL, LIMITE_DESTACADOS, SOCIO_DESTACADO_SQL, SOCIO_VIGENTE_SQL, avisarWeb, idValido, paginar } from "../utils.js";

const router = Router();

/**
 * Catálogo público, por RONDAS para que haya variedad:
 *   Ronda 1: el mejor producto de cada aliado · Ronda 2: el 2.º de cada uno · Luego todo lo demás.
 *   Dentro de cada ronda: 1. impulso vigente  2. Premium  3. productos estrella
 *   4. prioridad del admin  5. rotación diaria  6. más recientes.
 *   Así quien paga sale primero, pero una tienda con 100 productos no tapa a las demás.
 * ?destacados=1 -> solo productos estrella, máximo 2 por aliado (vitrina del inicio).
 * Solo productos disponibles (los agotados se ven únicamente dentro de la tienda del aliado).
 */
router.get("/", async (req, res) => {
  const { page, limit, offset } = paginar(req.query, 24);
  const where = ["p.activo = 1", DISPONIBLE_SQL, SOCIO_VIGENTE_SQL];
  const params = [];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    where.push("(p.nombre LIKE ? OR p.descripcion LIKE ? OR s.nombre_negocio LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.socio) {
    where.push("s.slug = ?");
    params.push(String(req.query.socio));
  }
  if (req.query.categoria) {
    where.push("s.categoria = ?");
    params.push(String(req.query.categoria));
  }
  const soloDestacados = req.query.destacados === "1";
  const filtroExterno = soloDestacados ? "WHERE t.destacado = 1 AND t.rn <= 2" : "";

  const base = `
    SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen_url, p.destacado, p.created_at,
           (p.maneja_stock = 1 AND p.stock BETWEEN 1 AND 3) AS ultimas,
           s.id AS socio_id, s.slug AS socio_slug, s.nombre_negocio AS vendedor, s.plan AS socio_plan,
           ${SOCIO_DESTACADO_SQL} AS socio_destacado, s.prioridad,
           CRC32(CONCAT(s.id, '-', CURDATE())) AS rotacion,
           ROW_NUMBER() OVER (PARTITION BY p.socio_id ORDER BY p.destacado DESC, p.created_at DESC) AS rn
      FROM productos p JOIN socios s ON s.id = p.socio_id
     WHERE ${where.join(" AND ")}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM (${base}) t ${filtroExterno}`, params);
  const [rows] = await db.query(
    `SELECT t.id, t.nombre, t.descripcion, t.precio, t.imagen_url, t.destacado, t.ultimas,
            t.socio_id, t.socio_slug, t.vendedor, t.socio_plan, t.socio_destacado
       FROM (${base}) t ${filtroExterno}
      ORDER BY LEAST(t.rn, 3), t.socio_destacado DESC, (t.socio_plan = 'PREMIUM') DESC, t.rn, t.destacado DESC,
               t.prioridad DESC, t.rotacion, t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({
    productos: rows.map((r) => ({
      ...r,
      disponible: true,
      destacado: Boolean(r.destacado),
      ultimas: Boolean(r.ultimas),
      socio_destacado: Boolean(r.socio_destacado),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

// Productos del aliado logueado (activos e inactivos, con su stock real) — visibles aunque la membresía esté vencida
router.get("/mios", requireAuth("SOCIO"), cargarSocio, async (req, res) => {
  const [rows] = await db.query(
    `SELECT p.*, ${DISPONIBLE_SQL} AS se_puede_pedir FROM productos p WHERE p.socio_id = ? ORDER BY p.destacado DESC, p.created_at DESC`,
    [req.socio.id]
  );
  res.json({ productos: rows, limite_destacados: LIMITE_DESTACADOS[req.socio.plan] ?? 2 });
});

const urlOpcional = z
  .string()
  .trim()
  .url("La imagen debe ser una URL válida")
  .max(500)
  .nullable()
  .or(z.literal("").transform(() => null));

const bandera = z.boolean().transform((v) => (v ? 1 : 0));

const crearSchema = z.object({
  nombre: z.string().trim().min(2, "Nombre muy corto").max(150),
  descripcion: z.string().trim().max(3000).nullable().optional(),
  precio: z.number().positive("El precio debe ser mayor a 0").max(999_999_999),
  disponible: bandera.optional(),
  maneja_stock: bandera.optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  imagen_url: urlOpcional.optional(),
  destacado: bandera.optional(),
});

/** Respeta el cupo de productos estrella del plan (BASICO 2, PREMIUM 8). */
async function cupoDestacados(socioId, plan, excluirProductoId = 0) {
  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM productos WHERE socio_id = ? AND activo = 1 AND destacado = 1 AND id <> ?", [
    socioId,
    excluirProductoId,
  ]);
  const limite = LIMITE_DESTACADOS[plan] ?? 2;
  return n < limite ? null : `Tu plan permite ${limite} productos recomendados. Quita la estrella de otro producto primero.`;
}

// Solo socios APROBADOS y al día publican
router.post("/", requireAuth("SOCIO"), cargarSocio, exigirSocioVigente, validate(crearSchema), async (req, res) => {
  const d = req.body;
  if (d.destacado) {
    const err = await cupoDestacados(req.socio.id, req.socio.plan);
    if (err) return res.status(400).json({ error: err, code: "CUPO_DESTACADOS" });
  }
  const [r] = await db.query(
    `INSERT INTO productos (socio_id, nombre, descripcion, precio, stock, disponible, maneja_stock, imagen_url, destacado)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.socio.id, d.nombre, d.descripcion ?? null, d.precio, d.stock ?? 0, d.disponible ?? 1, d.maneja_stock ?? 0, d.imagen_url ?? null, d.destacado ?? 0]
  );
  avisarWeb("productos", "aliados");
  res.status(201).json({ id: r.insertId });
});

// ---- Editar / ocultar: SOLO el aliado dueño del producto y al día ----
const soloDueno = [requireAuth("SOCIO"), cargarSocio, exigirSocioVigente, async (req, res, next) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const [rows] = await db.query("SELECT id FROM productos WHERE id = ? AND socio_id = ?", [id, req.socio.id]);
  if (!rows[0]) return res.status(404).json({ error: "Producto no encontrado" }); // no revela productos ajenos
  req.productoId = id;
  next();
}];

const editarSchema = z
  .object({
    nombre: z.string().trim().min(2).max(150),
    descripcion: z.string().trim().max(3000).nullable(),
    precio: z.number().positive().max(999_999_999),
    disponible: bandera,
    maneja_stock: bandera,
    stock: z.number().int().min(0).max(1_000_000),
    imagen_url: urlOpcional,
    activo: bandera,
    destacado: bandera,
  })
  .partial();

router.put("/:id", ...soloDueno, validate(editarSchema), async (req, res) => {
  const campos = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
  if (req.body.destacado === 1) {
    const err = await cupoDestacados(req.socio.id, req.socio.plan, req.productoId);
    if (err) return res.status(400).json({ error: err, code: "CUPO_DESTACADOS" });
  }
  // Las claves salen del esquema validado por zod, no del cliente
  await db.query(`UPDATE productos SET ${campos.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [
    ...campos.map(([, v]) => v),
    req.productoId,
  ]);
  avisarWeb("productos", "aliados");
  res.json({ ok: true });
});

// Borrado lógico: conserva el historial de pedidos
router.delete("/:id", ...soloDueno, async (req, res) => {
  await db.query("UPDATE productos SET activo = 0, destacado = 0 WHERE id = ?", [req.productoId]);
  avisarWeb("productos", "aliados");
  res.json({ ok: true });
});

export default router;
