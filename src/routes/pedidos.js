// src/routes/pedidos.js — BASE: tu archivo original.
// Cambios:
//  - Un carrito con productos de varios aliados genera UN PEDIDO POR ALIADO (como Mercado Libre),
//    así cada aliado gestiona y cobra lo suyo. Requiere la columna pedidos.socio_id (migración).
//  - Solo se compra a aliados al día; no puedes comprarte a ti mismo; nota opcional.
//  - GET /           -> mis compras (cualquier rol)
//    GET /ventas     -> pedidos recibidos por el aliado logueado
//    PATCH /ventas/:id      -> el aliado cambia el estado (PAGADO, ENVIADO, ENTREGADO, CANCELADO)
//    PATCH /:id/cancelar    -> el cliente cancela si sigue PENDIENTE (devuelve stock)
//  - El ADMIN ve todo en GET /api/admin/pedidos.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/errors.js";
import { evaluarReferido } from "../referidos.js";
import { cargarSocio, exigirSocioVigente } from "../middleware/socio.js";
import { SOCIO_VIGENTE_SQL, adjuntarItems, avisarWeb, devolverStock, idValido } from "../utils.js";

const router = Router();

const pedidoSchema = z.object({
  items: z
    .array(z.object({ productoId: z.number().int().positive(), cantidad: z.number().int().min(1).max(100) }))
    .min(1)
    .max(50),
  nota: z.string().trim().max(500).optional(),
});

// Crear pedido(s). El precio SIEMPRE sale de la BD.
router.post("/", requireAuth("CLIENTE", "SOCIO"), validate(pedidoSchema), async (req, res) => {
  const merged = new Map();
  for (const it of req.body.items) merged.set(it.productoId, (merged.get(it.productoId) ?? 0) + it.cantidad);
  const ids = [...merged.keys()].sort((a, b) => a - b); // orden fijo evita deadlocks

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const porSocio = new Map(); // socio_id -> [[productoId, cantidad, precio]]

    for (const id of ids) {
      const cantidad = merged.get(id);
      const [r] = await conn.query(
        `SELECT p.id, p.nombre, p.precio, p.stock, p.disponible, p.maneja_stock, p.socio_id, s.usuario_id AS socio_usuario_id
           FROM productos p JOIN socios s ON s.id = p.socio_id
          WHERE p.id = ? AND p.activo = 1 AND ${SOCIO_VIGENTE_SQL} FOR UPDATE`,
        [id]
      );
      const p = r[0];
      // v4: "Agotado" bloquea el pedido; las unidades solo se cuentan si el aliado activó el control.
      // El mensaje no revela cuántas unidades quedan.
      const sinUnidades = p && p.maneja_stock && p.stock < cantidad;
      if (!p || !p.disponible || sinUnidades) {
        await conn.rollback();
        return res.status(409).json({
          error: !p || !p.disponible ? `"${p?.nombre ?? "El producto"}" está agotado o no disponible` : `No hay suficientes unidades de "${p.nombre}". Pide menos cantidad.`,
        });
      }
      if (p.socio_usuario_id === req.user.id) {
        await conn.rollback();
        return res.status(400).json({ error: "No puedes comprar tus propios productos" });
      }
      if (p.maneja_stock) await conn.query("UPDATE productos SET stock = stock - ? WHERE id = ?", [cantidad, id]);
      if (!porSocio.has(p.socio_id)) porSocio.set(p.socio_id, []);
      porSocio.get(p.socio_id).push([id, cantidad, p.precio]);
    }

    const pedidos = [];
    for (const [socioId, lineas] of porSocio) {
      const total = Math.round(lineas.reduce((acc, [, c, precio]) => acc + c * precio, 0) * 100) / 100;
      const [ped] = await conn.query("INSERT INTO pedidos (usuario_id, socio_id, total, nota) VALUES (?, ?, ?, ?)", [
        req.user.id,
        socioId,
        total,
        req.body.nota || null,
      ]);
      await conn.query("INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ?", [
        lineas.map((l) => [ped.insertId, ...l]),
      ]);
      pedidos.push({ id: ped.insertId, socio_id: socioId, total });
    }
    await conn.commit();
    avisarWeb("productos");
    res.status(201).json({ pedidos, pedidoId: pedidos[0].id, total: pedidos.reduce((a, p) => a + p.total, 0) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// Mis compras
router.get("/", requireAuth(), async (req, res) => {
  const [pedidos] = await db.query(
    `SELECT pe.id, pe.socio_id, pe.total, pe.estado, pe.nota, pe.created_at,
            s.nombre_negocio AS socio_nombre, s.slug AS socio_slug, s.whatsapp AS socio_whatsapp
       FROM pedidos pe LEFT JOIN socios s ON s.id = pe.socio_id
      WHERE pe.usuario_id = ? ORDER BY pe.created_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json({ pedidos: await adjuntarItems(pedidos) });
});

// Ventas del aliado (se pueden consultar aunque la membresía esté vencida)
router.get("/ventas", requireAuth("SOCIO"), cargarSocio, async (req, res) => {
  const [pedidos] = await db.query(
    `SELECT pe.id, pe.total, pe.estado, pe.nota, pe.created_at,
            u.nombre AS cliente_nombre, u.telefono AS cliente_telefono, u.email AS cliente_email
       FROM pedidos pe JOIN usuarios u ON u.id = pe.usuario_id
      WHERE pe.socio_id = ? ORDER BY pe.created_at DESC LIMIT 200`,
    [req.socio.id]
  );
  res.json({ pedidos: await adjuntarItems(pedidos) });
});

const estadoSchema = z.object({ estado: z.enum(["PAGADO", "ENVIADO", "ENTREGADO", "CANCELADO"]) });

router.patch("/ventas/:id", requireAuth("SOCIO"), cargarSocio, exigirSocioVigente, validate(estadoSchema), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query("SELECT id, estado, usuario_id FROM pedidos WHERE id = ? AND socio_id = ? FOR UPDATE", [id, req.socio.id]);
    if (!p || p.estado === "CANCELADO") {
      await conn.rollback();
      return res.status(p ? 400 : 404).json({ error: p ? "El pedido ya está cancelado" : "Pedido no encontrado" });
    }
    if (req.body.estado === "CANCELADO") await devolverStock(conn, id);
    await conn.query("UPDATE pedidos SET estado = ? WHERE id = ?", [req.body.estado, id]);
    await conn.commit();
    if (req.body.estado === "ENTREGADO") evaluarReferido(p.usuario_id); // requisito COMPRA
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// El cliente cancela su pedido mientras siga PENDIENTE
router.patch("/:id/cancelar", requireAuth(), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query("SELECT id, estado FROM pedidos WHERE id = ? AND usuario_id = ? FOR UPDATE", [id, req.user.id]);
    if (!p || p.estado !== "PENDIENTE") {
      await conn.rollback();
      return res.status(p ? 400 : 404).json({ error: p ? "Solo puedes cancelar pedidos pendientes" : "Pedido no encontrado" });
    }
    await devolverStock(conn, id);
    await conn.query("UPDATE pedidos SET estado = 'CANCELADO' WHERE id = ?", [id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

export default router;
