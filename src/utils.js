import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

export const CATEGORIAS_NOTICIA = ["local", "nacional", "deportes", "entretenimiento", "economia", "sucesos"];
export const SOCIO_VIGENTE_SQL =
  "(s.estado = 'APROBADO' AND s.pagado_hasta IS NOT NULL AND s.pagado_hasta >= CURDATE())";

export const SOCIO_DESTACADO_SQL = "(s.destacado_hasta IS NOT NULL AND s.destacado_hasta >= CURDATE())";
export const ORDEN_SOCIOS_SQL = `${SOCIO_DESTACADO_SQL} DESC, (s.plan = 'PREMIUM') DESC, s.prioridad DESC, CRC32(CONCAT(s.id, '-', CURDATE()))`;
export const LIMITE_DESTACADOS = { BASICO: 2, PREMIUM: 8 };
export const EN_LINEA_SQL = "(u.ultimo_acceso IS NOT NULL AND u.ultimo_acceso >= NOW() - INTERVAL 5 MINUTE)";
export const DISPONIBLE_SQL = "(p.disponible = 1 AND (p.maneja_stock = 0 OR p.stock > 0))";


export function avisarWeb(...tags) {
  if (!config.revalidateSecret) return;
  const avisar = () =>
    fetch(`${config.appUrl}/api/revalidar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": config.revalidateSecret },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  avisar();
  setTimeout(avisar, 1500).unref();
}

const DOMINIOS_TEMPORALES = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "throwawaymail.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "moakt.com",
]);
export const esCorreoTemporal = (email) => DOMINIOS_TEMPORALES.has(String(email).split("@")[1]?.toLowerCase());

const ALFABETO_REF = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generarCodigoRef() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => ALFABETO_REF[b % ALFABETO_REF.length]).join("");
}

export function slugify(texto) {
  return (
    String(texto || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 140) || "item"
  );
}

export async function slugUnico(tabla, base, excluirId = 0, conn = db) {
  const raiz = slugify(base);
  for (let i = 1; i < 500; i++) {
    const candidato = i === 1 ? raiz : `${raiz}-${i}`;
    const [rows] = await conn.query(`SELECT id FROM ${tabla} WHERE slug = ? AND id <> ? LIMIT 1`, [candidato, excluirId]);
    if (!rows.length) return candidato;
  }
  return `${raiz}-${Date.now()}`;
}

export function paginar(q, porDefecto = 12) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(q.limit, 10) || porDefecto));
  return { page, limit, offset: (page - 1) * limit };
}

export function idValido(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function adjuntarItems(pedidos) {
  if (!pedidos.length) return pedidos;
  const [items] = await db.query(
    `SELECT pi.id, pi.pedido_id, pi.producto_id, pi.cantidad, pi.precio_unitario,
            COALESCE(p.nombre, 'Producto eliminado') AS nombre, p.imagen_url
       FROM pedido_items pi LEFT JOIN productos p ON p.id = pi.producto_id
      WHERE pi.pedido_id IN (?) ORDER BY pi.id`,
    [pedidos.map((p) => p.id)]
  );
  return pedidos.map((p) => ({ ...p, items: items.filter((i) => i.pedido_id === p.id) }));
}

export async function devolverStock(conn, pedidoId) {
  await conn.query(
    `UPDATE productos p JOIN pedido_items pi ON pi.producto_id = p.id
        SET p.stock = p.stock + pi.cantidad WHERE pi.pedido_id = ? AND p.maneja_stock = 1`,
    [pedidoId]
  );
}
