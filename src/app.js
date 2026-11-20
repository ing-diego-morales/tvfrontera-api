import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { db } from "./db.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import authRoutes from "./routes/auth.js";
import sociosRoutes from "./routes/socios.js";
import productosRoutes from "./routes/productos.js";
import pedidosRoutes from "./routes/pedidos.js";
import adminRoutes from "./routes/admin.js";
import visitorsRoutes from "./routes/visitors.js";
import noticiasRoutes from "./routes/noticias.js";
import verificacionRoutes from "./routes/verificacion.js";
import anunciosRoutes from "./routes/anuncios.js";
import referidosRoutes from "./routes/referidos.js";
import categoriasRoutes from "./routes/categorias.js";
import preguntasRoutes from "./routes/preguntas.js";
import { CARPETA_UPLOADS } from "./facebook.js";
import suscriptoresRoutes from "./routes/suscriptores.js";
import { programacion, secciones, sitio } from "./routes/contenido.js";

export const app = express();

// IP real del visitante: en producción detrás de proxy/cPanel; en desarrollo las peticiones llegan
// reenviadas por la web (Next, en este mismo equipo), así que se confía solo en ese reenvío local.
// TRUST_PROXY permite ajustarlo si el hosting agrega más intermediarios (número de saltos).
app.set("trust proxy", process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : config.isProd ? 1 : "loopback");
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// ---------- CORS ----------
// Solo los orígenes de CORS_ORIGINS. "credentials" permite enviar/recibir la cookie de sesión.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl, Postman, servidor-a-servidor
      cb(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  })
);

// Fotos importadas de Facebook (solo lectura, sin listar carpetas, caché de 7 días)
app.use("/uploads", express.static(CARPETA_UPLOADS, { index: false, dotfiles: "deny", maxAge: "7d", fallthrough: false }));

// Solo esta ruta recibe fotos (3 en base64): el resto de la API mantiene el límite de 100 KB
app.use("/api/verificacion/fotos", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Defensa extra contra CSRF: las peticiones que modifican datos deben venir de un origen permitido
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!SAFE.has(req.method) && origin && !config.corsOrigins.includes(origin))
    return res.status(403).json({ error: "Origen no permitido" });
  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(503).json({ ok: false, db: false, code: e.code });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/socios", sociosRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/visitors", visitorsRoutes);
app.use("/api/noticias", noticiasRoutes);
app.use("/api/verificacion", verificacionRoutes);
app.use("/api/anuncios", anunciosRoutes);
app.use("/api/referidos", referidosRoutes);
app.use("/api/categorias", categoriasRoutes);
app.use("/api/preguntas", preguntasRoutes);
app.use("/api/suscriptores", suscriptoresRoutes);
app.use("/api/secciones", secciones);
app.use("/api/programacion", programacion);
app.use("/api/sitio", sitio);

app.use(notFound);
app.use(errorHandler);
