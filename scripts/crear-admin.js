// Uso: npm run crear-admin -- "Nombre" correo@dominio.com "ClaveSegura123"
import bcrypt from "bcryptjs";
import { db } from "../src/db.js";

const [nombre, email, password] = process.argv.slice(2);
if (!nombre || !email || !password || password.length < 8) {
  console.error('Uso: npm run crear-admin -- "Nombre" correo clave(mín. 8)');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
await db.query(
  `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'ADMIN')
   ON DUPLICATE KEY UPDATE rol='ADMIN', password_hash=VALUES(password_hash), activo=1`,
  [nombre, email.toLowerCase(), hash]
);
console.log("Admin listo:", email.toLowerCase());
await db.end();
