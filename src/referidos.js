// src/referidos.js — NUEVO v6. Motor del programa de referidos de Televentas Fest
//
// Cómo funciona:
//   1. Cada usuario tiene un código (usuarios.codigo_ref) y comparte su enlace /registro?ref=CODIGO
//   2. Quien se registra con el enlace queda como referido PENDIENTE
//   3. Pasa a VALIDO solo cuando cumple el requisito que elija el admin (ajustes.referidos_requisito):
//        EMAIL     -> confirmó su correo Y registró su cédula (única en el sistema)
//        IDENTIDAD -> el admin verificó su identidad (cédula + rostro)
//        COMPRA    -> tiene al menos un pedido ENTREGADO
//      Los marcados como SOSPECHOSOS (misma IP, correo temporal...) nunca se validan solos: los revisa el admin.
//   4. Al validarse se revisan los premios del referidor:
//        METAS: al llegar a N referidos válidos en total (con cupo opcional de ganadores)
//        RETO DEL DÍA: "los primeros X que refieran a N HOY ganan" (predeterminado Lun-Dom o fecha puntual)
import { db } from "./db.js";
import { esCorreoTemporal } from "./utils.js";

export const REQUISITOS = ["EMAIL", "IDENTIDAD", "COMPRA"];

export async function ajustesReferidos(conn = db) {
  const [rows] = await conn.query("SELECT clave, valor FROM ajustes WHERE clave IN ('referidos_activo','referidos_requisito')");
  const m = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  return { activo: m.referidos_activo !== "0", requisito: REQUISITOS.includes(m.referidos_requisito) ? m.referidos_requisito : "EMAIL" };
}

/** Reto de una fecha: el de la fecha puntual si existe; si no, el predeterminado de ese día de la semana. */
export async function retoDe(fecha, conn = db) {
  const [[puntual]] = await conn.query("SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, activo, premio, descripcion, referidos_necesarios, ganadores FROM retos_fecha WHERE fecha = ?", [fecha]);
  if (puntual) return { ...puntual, activo: Boolean(puntual.activo), origen: "FECHA" };
  const [[semana]] = await conn.query(
    "SELECT dia, activo, premio, descripcion, referidos_necesarios, ganadores FROM retos_semana WHERE dia = WEEKDAY(?) + 1",
    [fecha]
  );
  return semana ? { ...semana, fecha, activo: Boolean(semana.activo), origen: "SEMANA" } : null;
}

/**
 * Al registrarse con un código: crea el referido (PENDIENTE) y lo marca SOSPECHOSO si:
 *  - la cuenta nueva usa la misma IP con la que se registró quien invita
 *  - desde esa IP se crearon 3 o más cuentas en las últimas 24 h
 *  - el correo es de un servicio de correos temporales
 * Devuelve el id del referidor o null si el código no sirve.
 */
export async function registrarReferido(conn, { referidoId, codigo, ip, email }) {
  if (!codigo) return null;
  const [[ref]] = await conn.query("SELECT id, registro_ip, rol, activo FROM usuarios WHERE codigo_ref = ? LIMIT 1", [String(codigo).toUpperCase()]);
  if (!ref || !ref.activo || ref.rol === "ADMIN" || ref.id === referidoId) return null;

  const motivos = [];
  if (ip && ref.registro_ip && ip === ref.registro_ip) motivos.push("misma IP que quien invita");
  if (ip) {
    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM usuarios WHERE registro_ip = ? AND created_at >= NOW() - INTERVAL 1 DAY", [ip]);
    if (n >= 3) motivos.push(`${n} cuentas desde la misma IP en 24 h`);
  }
  if (esCorreoTemporal(email)) motivos.push("correo temporal");

  await conn.query("UPDATE usuarios SET referido_por = ? WHERE id = ?", [ref.id, referidoId]);
  await conn.query("INSERT INTO referidos (referidor_id, referido_id, sospechoso, motivo) VALUES (?,?,?,?)", [
    ref.id,
    referidoId,
    motivos.length ? 1 : 0,
    motivos.join("; ") || null,
  ]);
  return ref.id;
}

/** ¿El referido ya cumple el requisito configurado? */
async function cumpleRequisito(referidoId, requisito) {
  const [[u]] = await db.query("SELECT activo, cedula, email_verificado, verificacion FROM usuarios WHERE id = ?", [referidoId]);
  if (!u || !u.activo) return false;
  if (requisito === "IDENTIDAD") return u.verificacion === "VERIFICADO";
  if (requisito === "COMPRA") {
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM pedidos WHERE usuario_id = ? AND estado = 'ENTREGADO'", [referidoId]);
    return n > 0;
  }
  return Boolean(u.email_verificado && u.cedula); // EMAIL
}

/**
 * Llamar cada vez que algo del referido cambia (confirmó correo, puso cédula, lo verificaron, compró).
 * Nunca lanza: un error aquí no debe romper la acción principal del usuario.
 */
export async function evaluarReferido(referidoId) {
  try {
    const [[r]] = await db.query("SELECT id, referidor_id, estado, sospechoso FROM referidos WHERE referido_id = ?", [referidoId]);
    if (!r || r.estado !== "PENDIENTE" || r.sospechoso) return;
    const { activo, requisito } = await ajustesReferidos();
    if (!activo || !(await cumpleRequisito(referidoId, requisito))) return;
    const [u] = await db.query("UPDATE referidos SET estado = 'VALIDO', validado_en = NOW() WHERE id = ? AND estado = 'PENDIENTE'", [r.id]);
    if (u.affectedRows) await evaluarPremios(r.referidor_id);
  } catch (e) {
    console.error("evaluarReferido:", e.message);
  }
}

/** Revisa metas y reto del día del referidor. Usa un candado para que dos validaciones simultáneas no repartan de más. */
export async function evaluarPremios(referidorId) {
  const conn = await db.getConnection();
  let candado = false;
  try {
    const [[{ ok }]] = await conn.query("SELECT GET_LOCK('tvf_premios', 10) AS ok");
    candado = ok === 1;
    if (!candado) return;

    const [[u]] = await conn.query("SELECT activo, rol FROM usuarios WHERE id = ?", [referidorId]);
    if (!u || !u.activo || u.rol === "ADMIN") return;

    const [[{ total, hoy }]] = await conn.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(DATE(validado_en) = CURDATE()), 0) AS hoy
         FROM referidos WHERE referidor_id = ? AND estado = 'VALIDO'`,
      [referidorId]
    );

    // --- Metas acumuladas ---
    const [metas] = await conn.query(
      `SELECT m.id, m.nombre, m.cupo, (SELECT COUNT(*) FROM premios_ganados g WHERE g.meta_id = m.id AND g.estado <> 'ANULADO') AS ganadores
         FROM premios_metas m
        WHERE m.activo = 1 AND m.referidos_necesarios <= ?
          AND NOT EXISTS (SELECT 1 FROM premios_ganados g WHERE g.meta_id = m.id AND g.usuario_id = ?)`,
      [total, referidorId]
    );
    for (const m of metas) {
      if (m.cupo !== null && m.ganadores >= m.cupo) continue;
      await conn.query("INSERT IGNORE INTO premios_ganados (usuario_id, tipo, meta_id, premio, posicion) VALUES (?, 'META', ?, ?, ?)", [
        referidorId,
        m.id,
        m.nombre,
        m.ganadores + 1,
      ]);
    }

    // --- Reto del día ---
    const [[{ fecha }]] = await conn.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS fecha");
    const reto = await retoDe(fecha, conn);
    if (reto?.activo && Number(hoy) >= reto.referidos_necesarios) {
      const [[{ ya, ganadores }]] = await conn.query(
        `SELECT COALESCE(SUM(usuario_id = ?), 0) AS ya, COUNT(*) AS ganadores
           FROM premios_ganados WHERE tipo = 'RETO' AND fecha_reto = ? AND estado <> 'ANULADO'`,
        [referidorId, fecha]
      );
      if (!Number(ya) && ganadores < reto.ganadores) {
        await conn.query("INSERT IGNORE INTO premios_ganados (usuario_id, tipo, fecha_reto, premio, posicion) VALUES (?, 'RETO', ?, ?, ?)", [
          referidorId,
          fecha,
          reto.premio,
          ganadores + 1,
        ]);
      }
    }
  } catch (e) {
    console.error("evaluarPremios:", e.message);
  } finally {
    if (candado) await conn.query("SELECT RELEASE_LOCK('tvf_premios')").catch(() => {});
    conn.release();
  }
}

/** "Juan Pérez Gómez" -> "Juan P." (para rankings públicos sin exponer nombres completos) */
export const nombreCorto = (n) => {
  const [a, b] = String(n ?? "").trim().split(/\s+/);
  return b ? `${a} ${b[0].toUpperCase()}.` : a || "Usuario";
};
