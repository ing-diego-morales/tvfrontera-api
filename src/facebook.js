// src/facebook.js — NUEVO v6. Importa las publicaciones de la página de Facebook como NOTICIAS del sitio.
// Se activa solo si FB_PAGE_ID y FB_PAGE_TOKEN están en .env (ver README). Revisa cada FB_SYNC_MINUTOS (15).
//   - No duplica: cada publicación se guarda una vez (fuente + id de Facebook únicos)
//   - Si el admin edita una noticia importada, no se sobrescribe
//   - Las fotos se DESCARGAN: los enlaces de imágenes de Facebook caducan a los pocos días
//   - ajustes.facebook_publicar = 1 -> se publican solas; 0 -> quedan en BORRADOR para revisar
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db.js";
import { config } from "./config.js";
import { CATEGORIAS_NOTICIA, avisarWeb, slugUnico } from "./utils.js";

// DATA_DIR = disco persistente en producción (ej. el volumen de Railway en /data). En local: la carpeta del proyecto.
export const CARPETA_UPLOADS = path.resolve(process.env.DATA_DIR || ".", "uploads");
const CARPETA_FB = path.join(CARPETA_UPLOADS, "facebook");
const VERSION = process.env.FB_GRAPH_VERSION || "v21.0";
const MAX_IMAGEN = 5 * 1024 * 1024;

export const estadoFacebook = { configurado: false, ultima: null, importadas: 0, error: null, sincronizando: false };

/** "Primera línea del post" -> título (máx. 120 caracteres sin cortar palabras) */
function titular(texto) {
  const linea = String(texto).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  if (linea.length <= 120) return linea;
  const corte = linea.slice(0, 117);
  return `${corte.slice(0, corte.lastIndexOf(" ") > 60 ? corte.lastIndexOf(" ") : 117)}…`;
}

/** Descarga la foto (solo servidores de Facebook, solo imágenes, máx. 5 MB) y devuelve su URL pública en esta API */
async function guardarImagen(url, postId) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !/(^|\.)(fbcdn\.net|facebook\.com)$/.test(u.hostname)) return null;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const tipo = r.headers.get("content-type") ?? "";
    if (!r.ok || !tipo.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGEN) return null;
    const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : "jpg";
    const nombre = `${String(postId).replace(/[^\w-]/g, "_")}.${ext}`;
    await fs.mkdir(CARPETA_FB, { recursive: true });
    await fs.writeFile(path.join(CARPETA_FB, nombre), buf);
    return `${config.apiUrl}/uploads/facebook/${nombre}`;
  } catch {
    return null;
  }
}

/**
 * Guarda una lista de publicaciones (formato de la Graph API) como noticias. Devuelve cuántas son nuevas.
 * Exportada para poder probarla sin conectarse a Facebook.
 */
export async function importarPublicaciones(posts) {
  const [rows] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('facebook_publicar','facebook_categoria')");
  const a = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  const publicar = a.facebook_publicar === "1";
  const categoria = CATEGORIAS_NOTICIA.includes(a.facebook_categoria) ? a.facebook_categoria : "local";
  let nuevas = 0;

  for (const p of posts) {
    if (!p?.id) continue;
    const [[ya]] = await db.query("SELECT id FROM noticias WHERE fuente = 'FACEBOOK' AND fuente_id = ?", [p.id]);
    if (ya) continue;
    const adjunto = p.attachments?.data?.[0];
    const mensaje = String(p.message ?? "").trim();
    const titulo = titular(mensaje || adjunto?.title || "");
    if (titulo.length < 5) continue; // publicaciones sin texto (solo foto) no sirven como noticia
    const resto = mensaje.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(1).join(" ");
    const resumen = (resto || adjunto?.description || "").slice(0, 400) || null;
    const imagen = p.full_picture ? await guardarImagen(p.full_picture, p.id) : null;
    const fecha = p.created_time ? new Date(p.created_time) : new Date();

    const [r] = await db.query(
      `INSERT IGNORE INTO noticias (slug, titulo, resumen, contenido, categoria, imagen_url, fuente, fuente_id, fuente_url, estado, publicada_en)
       VALUES (?,?,?,?,?,?, 'FACEBOOK', ?, ?, ?, ?)`,
      [
        await slugUnico("noticias", titulo),
        titulo.slice(0, 200),
        resumen,
        mensaje || adjunto?.description || null,
        categoria,
        imagen,
        p.id,
        typeof p.permalink_url === "string" && p.permalink_url.startsWith("https://") ? p.permalink_url : null,
        publicar ? "PUBLICADA" : "BORRADOR",
        publicar ? fecha : null,
      ]
    );
    if (r.affectedRows) nuevas++;
  }
  if (nuevas) avisarWeb("noticias");
  return nuevas;
}

/** Consulta la página en Facebook e importa lo nuevo */
export async function sincronizarFacebook() {
  const { pageId, token } = config.facebook;
  if (!pageId || !token) return { ok: false, error: "Facebook no está configurado (FB_PAGE_ID y FB_PAGE_TOKEN en .env)" };
  if (estadoFacebook.sincronizando) return { ok: false, error: "Ya hay una sincronización en curso" };
  estadoFacebook.sincronizando = true;
  try {
    const campos = "id,message,created_time,permalink_url,full_picture,attachments{media_type,title,description}";
    const url = `https://graph.facebook.com/${VERSION}/${encodeURIComponent(pageId)}/posts?fields=${encodeURIComponent(campos)}&limit=25`;
    // El token va en la cabecera, no en la URL (no queda en registros de servidores intermedios)
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Error ${r.status}`);
    const nuevas = await importarPublicaciones(d.data ?? []);
    Object.assign(estadoFacebook, { ultima: new Date().toISOString(), importadas: estadoFacebook.importadas + nuevas, error: null });
    return { ok: true, nuevas };
  } catch (e) {
    estadoFacebook.error = e.message;
    estadoFacebook.ultima = new Date().toISOString();
    console.error("❌ Facebook:", e.message);
    return { ok: false, error: e.message };
  } finally {
    estadoFacebook.sincronizando = false;
  }
}

/** Arranca la revisión periódica (llamado desde server.js) */
export function iniciarFacebook() {
  estadoFacebook.configurado = Boolean(config.facebook.pageId && config.facebook.token);
  if (!estadoFacebook.configurado) return;
  console.log(`✅ Facebook: importando publicaciones cada ${config.facebook.minutos} min`);
  setTimeout(sincronizarFacebook, 10_000);
  setInterval(sincronizarFacebook, config.facebook.minutos * 60_000).unref();
}
