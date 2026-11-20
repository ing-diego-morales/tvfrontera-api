// src/middleware/socio.js — perfil del Punto Aliado logueado y bloqueo por mensualidad
import { db } from "../db.js";
import { SOCIO_VIGENTE_SQL } from "../utils.js";

/** Carga req.socio (con .vigente 0/1). Usar después de requireAuth(). */
export async function cargarSocio(req, res, next) {
  try {
    const [rows] = await db.query(`SELECT s.*, ${SOCIO_VIGENTE_SQL} AS vigente FROM socios s WHERE s.usuario_id = ? LIMIT 1`, [
      req.user.id,
    ]);
    if (!rows[0]) {
      return res.status(404).json({ error: "Aún no tienes un perfil de Punto Aliado", code: "SIN_PERFIL_ALIADO" });
    }
    req.socio = { ...rows[0], vigente: Boolean(rows[0].vigente) };
    next();
  } catch (e) {
    next(e);
  }
}

export function motivoInactivo(s) {
  if (s.estado === "PENDIENTE") return "Tu solicitud de Punto Aliado aún está en revisión.";
  if (s.estado === "SUSPENDIDO") return "Tu cuenta de Punto Aliado está suspendida. Comunícate con TV Frontera.";
  if (!s.pagado_hasta) return "Tu cuenta fue aprobada; se activa cuando se registre el pago de la primera mensualidad.";
  return `Tu mensualidad venció el ${s.pagado_hasta}. Renueva para volver a mostrar tu tienda.`;
}

/** Bloquea acciones del aliado (publicar, editar, gestionar ventas) si no está al día. */
export function exigirSocioVigente(req, res, next) {
  if (req.socio.vigente) return next();
  res.status(403).json({ error: motivoInactivo(req.socio), code: "MEMBRESIA_INACTIVA" });
}
