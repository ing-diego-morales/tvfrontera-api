// src/schemas.js — validaciones compartidas (registro, solicitud de aliado y panel del aliado)
import { z } from "zod";

/** Campo opcional: "" o null se guardan como NULL */
export const opcional = (schema) => schema.nullable().optional().or(z.literal("").transform(() => null));

export const telefono = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{7,20}$/, "Número de teléfono inválido");

const instagram = z
  .string()
  .trim()
  .transform((v) => v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, ""))
  .pipe(z.string().regex(/^[\w.]{1,30}$/, "Usuario de Instagram inválido"));

const facebook = z
  .string()
  .trim()
  .url("El Facebook debe ser un enlace (https://facebook.com/...)")
  .max(200)
  .refine((u) => /^https:\/\/(www\.|m\.)?(facebook|fb)\.com\//i.test(u), "El enlace debe ser de facebook.com");

/**
 * CONTACTO OBLIGATORIO DEL ALIADO: WhatsApp + dirección (para que el cliente pueda escribir y llegar).
 * Teléfono fijo, horario y redes son opcionales.
 */
export const contactoAliado = {
  whatsapp: telefono,
  direccion: z.string().trim().min(5, "Escribe la dirección del negocio").max(200),
  telefono: opcional(telefono),
  horario: opcional(z.string().trim().max(150)),
  instagram: opcional(instagram),
  facebook: opcional(facebook),
};

export const negocioBase = {
  ciudad: z.string().trim().min(2, "Ciudad requerida").max(100),
  categoria: opcional(z.string().trim().max(80)),
  descripcion: opcional(z.string().trim().max(2000)),
  ...contactoAliado,
};
