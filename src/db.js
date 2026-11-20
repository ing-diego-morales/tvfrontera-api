import mysql from "mysql2/promise";
import { config } from "./config.js";

export const db = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  decimalNumbers: true, // DECIMAL llega como number
  dateStrings: ["DATE"], // columnas DATE (ej. pagado_hasta) como 'YYYY-MM-DD', sin corrimiento de zona horaria
  connectTimeout: 5000,
  timezone: "-05:00", // fechas leídas/escritas en hora de Colombia
});

// v6: hora de Colombia en TODAS las conexiones (NOW(), CURDATE()), aunque el servidor esté en otro país.
// Así los retos diarios de referidos y las mensualidades cambian de día a la medianoche de Colombia.
db.pool.on("connection", (conn) => {
  conn.query("SET time_zone = '-05:00'");
});
