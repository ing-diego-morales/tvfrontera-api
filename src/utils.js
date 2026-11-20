// src/utils.js — helpers compartidos
import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

export const CATEGORIAS_NOTICIA = ["local", "nacional", "deportes", "entretenimiento", "economia", "sucesos"];

/**
 * REGLA DE NEGOCIO CENTRAL: un aliado es visible solo si está APROBADO
 * y su mensualidad está al día (pagado_hasta >= hoy). Si no paga, él y todos
 * sus productos desaparecen solos del sitio, sin borrar nada.
 * Requiere el alias "s" para la tabla socios.
 */
export const SOCIO_VIGENTE_SQL =
  "(s.estado = 'APROBADO' AND s.pagado_hasta IS NOT NULL AND s.pagado_hasta >= CURDATE())";

/** Aliado con "impulso" vigente (lo vende/asigna el admin por fechas). Requiere el alias "s". */
export const SOCIO_DESTACADO_SQL = "(s.destacado_hasta IS NOT NULL AND s.destacado_hasta >= CURDATE())";

/**
 * POSICIONAMIENTO de aliados (directorio, inicio y catálogo). Con 200 aliados, quién sale primero:
 *   1. Impulso pagado vigente (destacado_hasta >= hoy)
 *   2. Plan PREMIUM
 *   3. Prioridad manual del admin (0-100), para afinar dentro del mismo nivel
 *   4. Rotación diaria: entre iguales el orden cambia cada día (CRC32 de id + fecha),
 *      así todos los aliados que pagan reciben exposición justa y nadie queda siempre de último.
 * El orden es estable durante el día, por lo que la paginación no repite ni salta aliados.
 */
export const ORDEN_SOCIOS_SQL = `${SOCIO_DESTACADO_SQL} DESC, (s.plan = 'PREMIUM') DESC, s.prioridad DESC, CRC32(CONCAT(s.id, '-', CURDATE()))`;

/** Cuántos productos "estrella" puede marcar cada aliado según su plan */
export const LIMITE_DESTACADOS = { BASICO: 2, PREMIUM: 8 };

/** "En línea" = actividad en los últimos 5 minutos. Requiere el alias "u" para usuarios. */
export const EN_LINEA_SQL = "(u.ultimo_acceso IS NOT NULL AND u.ultimo_acceso >= NOW() - INTERVAL 5 MINUTE)";

/**
 * Producto que se puede pedir. Requiere el alias "p".
 * Sin control de unidades basta con "Disponible"; con control, además debe quedar stock.
 */
export const DISPONIBLE_SQL = "(p.disponible = 1 AND (p.maneja_stock = 0 OR p.stock > 0))";

/**
 * Avisa a la web (Next) que borre la caché de estas etiquetas para que el cambio se vea al instante.
 * No bloquea ni falla la petición: si la web no responde, igual se actualiza sola en 60 s.
 * Etiquetas: avisos, noticias, aliados, productos
 */
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
  // Segundo aviso: si justo antes del cambio una visita lanzó una regeneración en segundo plano con datos
  // viejos, esa regeneración puede terminar DESPUÉS del primer aviso. Este la descarta.
  setTimeout(avisar, 1500).unref();
}

// Correos desechables: típicos para crear cuentas falsas en masa
const DOMINIOS_TEMPORALES = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "throwawaymail.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "moakt.com",
]);
export const esCorreoTemporal = (email) => DOMINIOS_TEMPORALES.has(String(email).split("@")[1]?.toLowerCase());

// Código de invitación: 8 caracteres sin letras que se confunden (0/O, 1/I/L)
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

/** Slug único en la tabla (agrega -2, -3...). `conn` puede ser el pool o una conexión de transacción. */
export async function slugUnico(tabla, base, excluirId = 0, conn = db) {
  const raiz = slugify(base);
  for (let i = 1; i < 500; i++) {
    const candidato = i === 1 ? raiz : `${raiz}-${i}`;
    const [rows] = await conn.query(`SELECT id FROM ${tabla} WHERE slug = ? AND id <> ? LIMIT 1`, [candidato, excluirId]);
    if (!rows.length) return candidato;
  }
  return `${raiz}-${Date.now()}`;
}

/** ?page=1&limit=12 */
export function paginar(q, porDefecto = 12) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(q.limit, 10) || porDefecto));
  return { page, limit, offset: (page - 1) * limit };
}

export function idValido(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Agrega pedido.items a cada pedido. */
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

/** Devuelve al inventario el stock de un pedido cancelado (dentro de transacción). */
export async function devolverStock(conn, pedidoId) {
  await conn.query(
    `UPDATE productos p JOIN pedido_items pi ON pi.producto_id = p.id
        SET p.stock = p.stock + pi.cantidad WHERE pi.pedido_id = ? AND p.maneja_stock = 1`,
    [pedidoId]
  );
}
