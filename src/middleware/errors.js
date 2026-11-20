import { z } from "zod";

z.config(z.locales.es()); // mensajes de validación en español

/** Valida req.body con un esquema zod y lo reemplaza por la versión limpia. */
export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const i = r.error.issues[0];
    const campo = i?.path?.join(".");
    return res.status(400).json({ error: i ? (campo ? `${campo}: ${i.message}` : i.message) : "Datos inválidos" });
  }
  req.body = r.data;
  next();
};

export function notFound(_req, res) {
  res.status(404).json({ error: "Ruta no encontrada" });
}

const ERRORES_CONEXION_BD = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR", "ECONNRESET"]);
let ultimoAvisoBd = 0;

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  // NUEVO: dato único repetido (correo, cédula, slug) -> 409 en vez de 500
  if (err.code === "ER_DUP_ENTRY") {
    const msg = /cedula/.test(err.sqlMessage)
      ? "Esa cédula ya está registrada"
      : /email/.test(err.sqlMessage)
        ? "Ese correo ya está registrado"
        : "Ese dato ya está registrado";
    return res.status(409).json({ error: msg });
  }
  // Base de datos apagada o inalcanzable: una línea clara en la consola (no la pila completa) y 503.
  // Se avisa como máximo una vez cada 30 s para no llenar la consola.
  if (ERRORES_CONEXION_BD.has(err.code)) {
    if (Date.now() - ultimoAvisoBd > 30_000) {
      ultimoAvisoBd = Date.now();
      console.error(`❌ Base de datos no disponible (${err.code}). ¿Está encendido MySQL en XAMPP? Revisa DB_HOST/DB_PORT o DATABASE_URL.`);
    }
    return res.status(503).json({ error: "Servicio temporalmente no disponible. Intenta de nuevo en unos segundos." });
  }
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  const mensaje =
    err.type === "entity.parse.failed" ? "JSON inválido" : status < 500 ? err.message : "Error del servidor";
  res.status(status).json({ error: mensaje });
}
