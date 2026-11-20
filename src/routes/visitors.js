import { Router } from "express";
import { db } from "../db.js";

const router = Router();

async function total() {
  const [rows] = await db.query("SELECT total FROM visitas WHERE id = 1");
  return Number(rows[0]?.total ?? 0);
}

// GET: lee el total | POST: suma una visita (llamar 1 vez por sesión desde el frontend)
router.get("/", async (_req, res) => res.json({ count: await total() }));

router.post("/", async (_req, res) => {
  await db.query("UPDATE visitas SET total = total + 1 WHERE id = 1");
  res.json({ count: await total() });
});

export default router;
