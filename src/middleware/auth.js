import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";

const { name, sameSite, secure, domain, maxAgeMs } = config.cookie;
const cookieBase = { httpOnly: true, sameSite, secure, domain, path: "/" };

/** Columnas del usuario que viajan a req.user y al frontend (nunca password_hash). */
export const CAMPOS_USUARIO = "id, nombre, email, email_verificado, telefono, cedula, codigo_ref, rol, activo, verificacion, sesion_version, created_at";

export function usuarioPublico(u) {
  if (!u) return null;
  const { password_hash, activo, sesion_version, ...resto } = u; // eslint-disable-line no-unused-vars
  return resto;
}

/** `user.sesion_version` viaja en el token como "v": si la contraseña cambia, la versión sube y el token deja de valer. */
export function setSessionCookie(res, user) {
  const token = jwt.sign({ email: user.email, nombre: user.nombre, rol: user.rol, v: user.sesion_version ?? 0 }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: Math.floor(maxAgeMs / 1000),
    algorithm: "HS256",
  });
  res.cookie(name, token, { ...cookieBase, maxAge: maxAgeMs });
}

export function clearSessionCookie(res) {
  // Debe coincidir en domain/path/sameSite con la cookie original
  res.clearCookie(name, cookieBase);
}

/**
 * CAMBIO: antes la sesión salía solo del token (el rol quedaba congelado 7 días).
 * Ahora el token solo identifica al usuario y sus datos se releen de la BD en cada
 * petición: si el admin lo desactiva, cambia su rol o lo verifica, aplica al instante.
 */
async function readSession(req, res, { actividad = true } = {}) {
  const token = req.cookies?.[name];
  if (!token) return null;
  let p;
  try {
    p = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  const [rows] = await db.query(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE id = ? LIMIT 1`, [Number(p.sub)]);
  const u = rows[0];
  // Usuario borrado/desactivado, o sesión de antes de un cambio de contraseña -> fuera
  if (!u || !u.activo || (p.v ?? 0) !== u.sesion_version) {
    clearSessionCookie(res);
    return null;
  }
  if (actividad) marcarActividad(u.id);
  return usuarioPublico(u);
}

/**
 * "En línea": guarda la última actividad. Como mucho 1 escritura por minuto por usuario
 * (la condición en el WHERE evita escribir en cada petición). No bloquea la respuesta.
 */
function marcarActividad(id) {
  db.query(
    "UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ? AND (ultimo_acceso IS NULL OR ultimo_acceso < NOW() - INTERVAL 1 MINUTE)",
    [id]
  ).catch(() => {});
}

/** Al cerrar sesión el usuario aparece desconectado de inmediato. */
export function marcarDesconectado(id) {
  return db.query("UPDATE usuarios SET ultimo_acceso = NOW() - INTERVAL 1 HOUR WHERE id = ?", [id]).catch(() => {});
}

/** Igual que authOptional pero sin registrar actividad (para el cierre de sesión). */
export async function authSinActividad(req, res, next) {
  try {
    req.user = await readSession(req, res, { actividad: false });
    next();
  } catch (e) {
    next(e);
  }
}

/** Pone req.user si hay sesión, pero deja pasar a anónimos. */
export async function authOptional(req, res, next) {
  try {
    req.user = await readSession(req, res);
    next();
  } catch (e) {
    next(e);
  }
}

/** Exige sesión; con roles, exige además uno de ellos. */
export const requireAuth =
  (...roles) =>
  async (req, res, next) => {
    try {
      req.user = await readSession(req, res);
      if (!req.user) return res.status(401).json({ error: "No autenticado", code: "NO_AUTENTICADO" });
      if (roles.length && !roles.includes(req.user.rol))
        return res.status(403).json({ error: "No tienes permiso", code: "SIN_PERMISO" });
      next();
    } catch (e) {
      next(e);
    }
  };
