import { config } from "./config.js";
import { app } from "./app.js";
import { db } from "./db.js";
import { iniciarFacebook } from "./facebook.js";

const server = app.listen(config.port, () => {
  console.log(`API Televentas Fest escuchando en http://localhost:${config.port}`);
  console.log("CORS permitido para:", config.corsOrigins.join(", "));
  iniciarFacebook();
});

db.query("SELECT 1")
  .then(() => console.log("MySQL conectado"))
  .catch((e) => console.error("No se pudo conectar a MySQL:", e.code ?? e.message, "(¿está iniciado en XAMPP?)"));

const shutdown = () => server.close(() => db.end().finally(() => process.exit(0)));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
