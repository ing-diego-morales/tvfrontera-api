// scripts/demo.js — DATOS DE DEMOSTRACIÓN (usuarios, aliados, productos, pedidos, referidos, noticias, suscriptores)
//
//   npm run demo -- crear     -> crea todo (no envía ningún correo: se inserta directo en la BD)
//   npm run demo -- borrar    -> elimina todo lo que creó este script
//
// Contraseña de TODAS las cuentas demo: Televentas2026*
// Las fotos se descargan una sola vez (Openverse, Creative Commons) a tvfrontera-web/public/demo
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { db } from "../src/db.js";
import { generarCodigoRef, slugUnico } from "../src/utils.js";
import { evaluarPremios } from "../src/referidos.js";
import { CARPETA_PRIVADA } from "../src/routes/verificacion.js";

const CLAVE = "Televentas2026*";
const WEB_DEMO = path.resolve("..", "tvfrontera-web", "public", "demo");

// [correo, nombre]
const PERSONAS = [
  ["anaemiliacarvajal063@gmail.com", "Ana Emilia Carvajal"],
  ["r86790754@gmail.com", "Ricardo Ramírez"],
  ["unksoa69@gmail.com", "Óscar Suárez"],
  ["jairosantamaria1902@gmail.com", "Jairo Santamaría"],
  ["moraxcarmelo16063@gmail.com", "Carmelo Mora"],
  ["montenegrolaura1004@gmail.com", "Laura Montenegro"],
  ["sairacotte@gmail.com", "Saira Cotte"],
  ["felipeespinosaa2103@gmail.com", "Felipe Espinosa"],
  ["mikegowsnlaiq626@gmail.com", "Miguel Gómez"],
  ["ramirezjsj829bro@gmail.com", "José Ramírez"],
  ["lskas45463214@gmail.com", "Lucas Castro"],
  ["aslytaianamora@gmail.com", "Asly Tatiana Mora"],
  ["juannmoraless3783@gmail.com", "Juan Morales"],
  ["23t65943753@gmail.com", "Tomás Herrera"],
  ["marrcossroa6337@gmail.com", "Marcos Roa"],
  ["cifuentespaola591@gmail.com", "Paola Cifuentes"],
  ["mariovario30@gmail.com", "Mario Vargas"],
  ["ana34fmarioss@gmail.com", "Ana Fernanda Marín"],
  ["andreafgmartinez2000@gmail.com", "Andrea Martínez"],
  ["rociogabriela959@gmail.com", "Rocío Gabriela Pérez"],
  ["delarosamartin2505@gmail.com", "Martín de la Rosa"],
  ["flordejamaicatorres@gmail.com", "Flor Torres"],
  ["marcelofemalwdiaz@gmail.com", "Marcelo Díaz"],
  ["gnzlvannessa972@gmail.com", "Vanessa González"],
  ["oliviaamoraless1903@gmail.com", "Olivia Morales"],
  ["marianos782vu@gmail.com", "Mariano Suárez"],
  ["kath39927@gmail.com", "Katherine Rojas"],
  ["koimundialdsak@gmail.com", "Kevin Ortiz"],
  ["zairazamora368@gmail.com", "Zaira Zamora"],
  ["andreasonanaroso20@gmail.com", "Andrea Sonana"],
  ["estaffaniarruedaa08@gmail.com", "Estefanía Rueda"],
  ["fernando452131@gmail.com", "Fernando Peña"],
  ["aslycardona6@gmail.com", "Asly Cardona"],
  ["martadiazsanxhes26@gmail.com", "Marta Díaz Sánchez"],
  ["lopezzmariacamilaa9384@gmail.com", "María Camila López"],
  ["mariana1999marty@gmail.com", "Mariana Martínez"],
  ["andresmaecos728@gmail.com", "Andrés Marcos"],
  ["sofiacifuentes364@gmail.com", "Sofía Cifuentes"],
  ["mbappkilian9@gmail.com", "Kilian Mendoza"],
  ["carlossgozalez38484@gmail.com", "Carlos González"],
  ["mairksi2618@gmail.com", "Mairk Silva"],
  ["uribensk62ga@gmail.com", "Daniel Uribe"],
  ["julianmlovpaola@gmail.com", "Julián López"],
  ["andresdadiogomez6@gmail.com", "Andrés Darío Gómez"],
  ["bluegonsalezz748@gmail.com", "Brayan González"],
];
const EMAILS = PERSONAS.map(([e]) => e);

// Negocios: [índice persona, nombre, categoría, plan, impulso(días), estado, descripción, dirección, horario, instagram, productos[nombre, precio, palabra para foto, descripción]]
const NEGOCIOS = [
  [0, "Delicias de Ana", "Restaurantes", "PREMIUM", 10, "AL_DIA", "Comida típica santandereana hecha en casa. Almuerzos ejecutivos y domicilios en todo Cúcuta.", "Av. 0 # 11-45, Centro", "Lun a Sáb 11:00 a.m. - 9:00 p.m.", "deliciasdeana", [
    ["Bandeja paisa completa", 28000, "bandeja paisa food", "Frijoles, arroz, chicharrón, carne molida, huevo, maduro y arepa."],
    ["Mute santandereano", 22000, "soup", "Sopa tradicional con maíz, callo y costilla. Sábados y domingos."],
    ["Almuerzo ejecutivo", 16000, "lunch plate", "Sopa del día, seco, jugo natural y postre."],
    ["Limonada de coco", 8000, "lemonade", "Refrescante y cremosa, preparada al momento."],
  ]],
  [7, "TecnoFrontera", "Tecnología", "PREMIUM", 7, "AL_DIA", "Accesorios y tecnología con garantía. Envíos el mismo día en el área metropolitana.", "C.C. Ventura Plaza, local 210", "Lun a Dom 10:00 a.m. - 8:00 p.m.", "tecnofrontera", [
    ["Audífonos inalámbricos", 89000, "headphones", "Bluetooth 5.3, 30 horas de batería y cancelación de ruido."],
    ["Cargador rápido 20W", 35000, "charger", "Compatible con iPhone y Android. Incluye cable USB-C."],
    ["Smartwatch deportivo", 145000, "smartwatch", "Ritmo cardíaco, pasos, notificaciones y resistente al agua."],
    ["Parlante bluetooth", 120000, "speaker", "Sonido potente, luces LED y 12 horas de música."],
    ["Funda antigolpes", 25000, "phone case", "Protección militar para los modelos más vendidos."],
  ]],
  [5, "Laura Moda Boutique", "Moda y accesorios", "PREMIUM", 0, "AL_DIA", "Ropa y accesorios para dama con las últimas tendencias. Tallas de la S a la XL.", "Calle 10 # 4-32, Centro", "Lun a Sáb 9:00 a.m. - 7:00 p.m.", "lauramodaboutique", [
    ["Vestido floral", 95000, "dress", "Tela fresca, ideal para el clima de Cúcuta."],
    ["Bolso de cuero", 160000, "handbag", "Cuero genuino hecho por artesanos de la región."],
    ["Blusa casual", 55000, "blouse", "Disponible en varios colores."],
    ["Jean clásico", 85000, "jeans", "Tiro alto, horma perfecta."],
  ]],
  [23, "Pizzería Napoli Cúcuta", "Restaurantes", "PREMIUM", 0, "AL_DIA", "Pizza artesanal en horno de leña. Domicilio gratis a partir de dos pizzas.", "Av. Libertadores # 15-60", "Todos los días 4:00 p.m. - 11:00 p.m.", "napolicucuta", [
    ["Pizza hawaiana familiar", 48000, "pizza", "Jamón, piña y mucho queso. 8 porciones."],
    ["Pizza pepperoni", 46000, "pepperoni pizza", "Pepperoni importado y salsa de la casa."],
    ["Lasaña boloñesa", 32000, "lasagna", "Gratinada al horno, con pan de ajo."],
    ["Gaseosa 1.5 L", 7000, "soda bottle", "Bien fría."],
  ]],
  [3, "Ferretería El Tornillo", "Hogar y ferretería", "BASICO", 0, "AL_DIA", "Todo para construcción, hogar y jardín. Asesoría sin costo.", "Av. 7 # 3-15, barrio Latino", "Lun a Sáb 7:00 a.m. - 6:00 p.m.", "ferreteriaeltornillo", [
    ["Taladro percutor 650W", 189000, "drill", "Incluye maletín y juego de brocas."],
    ["Juego de destornilladores", 45000, "screwdriver", "12 piezas con puntas imantadas."],
    ["Pintura tipo 1 (galón)", 72000, "paint", "Lavable, varios colores."],
    ["Cinta métrica 8 m", 18000, "tape measure", "Carcasa reforzada."],
  ]],
  [6, "Belleza Saira Spa", "Salud y belleza", "BASICO", 0, "AL_DIA", "Uñas, cabello y cuidado facial con productos profesionales.", "Calle 13 # 2E-40, Quinta Oriental", "Mar a Sáb 9:00 a.m. - 7:00 p.m.", "sairaspa", [
    ["Manicure semipermanente", 35000, "manicure", "Duración de hasta 3 semanas."],
    ["Corte y cepillado", 40000, "haircut", "Incluye lavado e hidratación."],
    ["Limpieza facial profunda", 70000, "skincare", "Con extracción y mascarilla."],
  ]],
  [11, "Panadería La Espiga Dorada", "Alimentos y bebidas", "BASICO", 0, "AL_DIA", "Pan caliente desde las 5:30 a.m. Tortas por encargo.", "Calle 6 # 9-20, barrio Blanco", "Todos los días 5:30 a.m. - 8:00 p.m.", "espigadorada", [
    ["Pan francés x 6", 6000, "bread", "Recién horneado."],
    ["Torta de chocolate", 45000, "chocolate cake", "Para 12 personas, por encargo."],
    ["Croissant de mantequilla", 4000, "croissant", "Hojaldrado y crujiente."],
    ["Café con leche", 3500, "coffee", "Café de Norte de Santander."],
  ]],
  [15, "Frutas y Verduras Paola", "Alimentos y bebidas", "BASICO", 0, "AL_DIA", "Frutas frescas de la región directo a tu casa.", "Mercado Cenabastos, bodega 12", "Lun a Sáb 5:00 a.m. - 2:00 p.m.", "frutaspaola", [
    ["Canasta de frutas", 35000, "fruit basket", "Selección de temporada."],
    ["Aguacate x 3", 9000, "avocado", "Maduros, listos para el almuerzo."],
    ["Mango de azúcar x 6", 8000, "mango", "Dulce y jugoso."],
  ]],
  [18, "Calzado Andrea", "Moda y accesorios", "BASICO", 0, "AL_DIA", "Calzado para toda la familia, nacional e importado.", "Calle 11 # 5-18, Centro", "Lun a Sáb 9:00 a.m. - 7:00 p.m.", "calzadoandrea", [
    ["Tenis deportivos", 130000, "sneakers", "Suela con amortiguación."],
    ["Sandalias de cuero", 70000, "sandals", "Cómodas para el día a día."],
    ["Botas de dama", 150000, "boots", "Tacón medio, cuero sintético."],
  ]],
  [21, "Floristería Jamaica", "Otro", "BASICO", 0, "AL_DIA", "Arreglos florales para toda ocasión con entrega a domicilio.", "Av. 0 # 20-14, Caobos", "Lun a Dom 8:00 a.m. - 6:00 p.m.", "floristeriajamaica", [
    ["Ramo de 12 rosas", 85000, "roses", "Incluye tarjeta personalizada."],
    ["Arreglo de girasoles", 65000, "sunflowers", "Ideal para alegrar cualquier día."],
  ]],
  [30, "Droguería Salud Total", "Salud y belleza", "BASICO", 0, "AL_DIA", "Medicamentos, cuidado personal y domicilios 24 horas.", "Calle 17 # 3-50, La Playa", "24 horas", "saludtotalcucuta", [
    ["Botiquín de primeros auxilios", 55000, "first aid kit", "Completo para hogar o carro."],
    ["Vitamina C x 100", 28000, "vitamins", "Refuerza tus defensas."],
    ["Protector solar FPS 50", 42000, "sunscreen", "Resistente al agua."],
  ]],
  [33, "Academia Speak Up", "Educación", "BASICO", 0, "AL_DIA", "Cursos de inglés para niños y adultos con profesores certificados.", "Calle 14 # 1-35, Ceiba II", "Lun a Sáb 7:00 a.m. - 8:00 p.m.", "speakupcucuta", [
    ["Curso de inglés básico (mes)", 180000, "classroom", "8 clases grupales de 2 horas."],
    ["Clases particulares (hora)", 45000, "study", "A domicilio o virtual."],
  ]],
  [37, "Mascotas Felices", "Otro", "BASICO", 0, "AL_DIA", "Alimento, accesorios y peluquería para tu mascota.", "Av. 4 # 12-30, Prados del Este", "Lun a Sáb 8:00 a.m. - 7:00 p.m.", "mascotasfelices", [
    ["Concentrado para perro 4 kg", 62000, "dog food", "Para adultos de todas las razas."],
    ["Juguete para gato", 15000, "cat toy", "Con hierba gatera."],
    ["Collar ajustable", 22000, "dog collar", "Varios colores y tallas."],
  ]],
  [39, "Repuestos Moto Carlos", "Automotriz", "BASICO", 0, "AL_DIA", "Repuestos originales y taller para motos de todas las marcas.", "Av. 6 # 8-90, El Contento", "Lun a Sáb 7:30 a.m. - 6:00 p.m.", "motocarlos", [
    ["Casco certificado", 210000, "helmet", "Norma NTC 4533."],
    ["Kit de arrastre", 95000, "motorcycle", "Cadena, piñón y corona."],
    ["Aceite 4T (litro)", 32000, "motor oil", "Sintético para alto rendimiento."],
  ]],
  [43, "ConectaNet Internet", "Telecomunicaciones", "BASICO", 0, "AL_DIA", "Internet por fibra óptica para hogares y negocios en Cúcuta.", "Calle 12 # 7-25, Centro", "Lun a Sáb 8:00 a.m. - 6:00 p.m.", "conectanet", [
    ["Plan hogar 300 Mbps (mes)", 79000, "router", "Instalación gratis."],
    ["Instalación de cámaras", 350000, "security camera", "Kit de 4 cámaras con app."],
  ]],
  [12, "Café Santander", "Alimentos y bebidas", "BASICO", 0, "PENDIENTE", "Café especial de las montañas de Norte de Santander.", "Calle 9 # 3-10, Centro", "Lun a Sáb 7:00 a.m. - 7:00 p.m.", "cafesantander", []],
  [20, "Lavautos La Rosa", "Automotriz", "BASICO", 0, "VENCIDO", "Lavado general, polichado y cojinería.", "Av. Gran Colombia # 4-80", "Lun a Dom 7:00 a.m. - 6:00 p.m.", "lavautoslarosa", [["Lavado general", 25000, "car wash", "Exterior e interior."]]],
];

const NOTICIAS = [
  ["Feria binacional reúne a cientos de emprendedores en Cúcuta", "local", "market", "Más de 300 emprendedores de Colombia y Venezuela participaron en la feria de este fin de semana en el centro de la ciudad."],
  ["Cúcuta Deportivo prepara su regreso con nuevos refuerzos", "deportes", "soccer", "El equipo motilón anunció la llegada de cinco jugadores para afrontar la próxima temporada."],
  ["Festival gastronómico: los sabores de Norte de Santander", "entretenimiento", "food festival", "El mute, la pepitoria y el pastel de garbanzo fueron los protagonistas del festival que se realizó en el Malecón."],
  ["Así cerró el dólar esta semana en la frontera", "economia", "money", "Casas de cambio reportaron estabilidad en el precio de la divisa durante los últimos días."],
  ["Jornada de vacunación gratuita en los barrios de la ciudad", "local", "vaccine", "La Secretaría de Salud habilitó puntos móviles para vacunar a niños y adultos mayores."],
  ["Obras en la avenida Libertadores avanzan en un 70 %", "local", "construction", "La administración municipal entregó un balance del proyecto vial que mejorará la movilidad del oriente."],
  ["Concierto de fin de año: artistas confirmados", "entretenimiento", "concert", "La gran fiesta de diciembre tendrá artistas nacionales e invitados de la región."],
  ["Comerciantes reportan aumento en ventas por temporada", "economia", "shopping", "El gremio de comerciantes del centro registró un crecimiento en las ventas de noviembre."],
  ["Recomendaciones para la temporada de lluvias", "sucesos", "rain", "Los organismos de socorro piden a la comunidad limpiar canales y evitar zonas de riesgo."],
];

const IPS = (i) => `181.${50 + (i % 40)}.${(i * 7) % 250}.${(i * 13) % 250}`; // IPs distintas: los referidos demo no salen "sospechosos"
const cedula = (i) => String(1090400000 + i * 137);
const telefono = (i) => `300 555 ${String(1000 + i).slice(-4)}`; // números de ejemplo

// Fotos de demostración: Openverse (imágenes Creative Commons de uso comercial), reducidas a WebP con sharp
// (el de tvfrontera-web) para que pesen pocos KB. Los créditos quedan en public/demo/CREDITOS.txt
const sharp = createRequire(path.resolve("..", "tvfrontera-web", "package.json"))("sharp");
const creditos = [];
const usadas = new Set();

async function buscarImagen(palabras, variante) {
  const q = encodeURIComponent(palabras.replace(/,/g, " "));
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${q}&page_size=20&license_type=commercial&extension=jpg`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const { results = [] } = await r.json();
  const libres = results.filter((x) => !usadas.has(x.url));
  return libres[variante % Math.max(1, libres.length)] ?? null;
}

async function foto(nombre, palabras, ancho = 640, alto = 640, variante = 0) {
  const destino = path.join(WEB_DEMO, `${nombre}.webp`);
  try {
    await fs.access(destino);
    return `/demo/${nombre}.webp`;
  } catch {}
  try {
    const img = await buscarImagen(palabras, variante);
    if (!img) return null;
    usadas.add(img.url);
    const r = await fetch(img.url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(ancho, alto, { fit: "cover" }).webp({ quality: 78 }).toFile(destino);
    creditos.push(`${nombre}.webp — "${img.title ?? "sin título"}" de ${img.creator ?? "autor desconocido"} (${img.license.toUpperCase()} ${img.license_version ?? ""}) ${img.foreign_landing_url ?? img.url}`);
    return `/demo/${nombre}.webp`;
  } catch {
    return null; // el sitio muestra el fondo de marca si no hay foto
  }
}

/** JPEG para las verificaciones de ejemplo (el panel de verificación solo acepta JPEG) */
async function fotoJpeg(palabras, variante) {
  try {
    const img = await buscarImagen(palabras, variante);
    if (!img) return null;
    const r = await fetch(img.url, { signal: AbortSignal.timeout(25000) });
    return await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(800, 600, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

async function borrar() {
  const [us] = await db.query("SELECT id FROM usuarios WHERE email IN (?) OR email LIKE '%@prueba.test'", [EMAILS]);
  const ids = us.map((u) => u.id);
  if (ids.length) {
    await db.query("DELETE pi FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id WHERE p.usuario_id IN (?) OR p.socio_id IN (SELECT id FROM socios WHERE usuario_id IN (?))", [ids, ids]);
    await db.query("DELETE FROM pedidos WHERE usuario_id IN (?) OR socio_id IN (SELECT id FROM socios WHERE usuario_id IN (?))", [ids, ids]);
    for (const id of ids) await fs.rm(path.join(CARPETA_PRIVADA, String(id)), { recursive: true, force: true });
    await db.query("DELETE FROM usuarios WHERE id IN (?)", [ids]); // en cascada: aliados, productos, referidos, premios, verificaciones
  }
  await db.query("DELETE FROM noticias WHERE fuente = 'DEMO'");
  await db.query("DELETE FROM suscriptores WHERE email IN (?)", [EMAILS]);
  console.log(`🧹 Datos demo eliminados (${ids.length} usuarios). Las fotos de public/demo se pueden borrar a mano.`);
}

async function crear() {
  await borrar();
  await fs.mkdir(WEB_DEMO, { recursive: true });
  const hash = await bcrypt.hash(CLAVE, 12);
  const idPorIndice = {};

  console.log("👥 Usuarios…");
  for (const [i, [email, nombre]] of PERSONAS.entries()) {
    const esAliado = NEGOCIOS.some((n) => n[0] === i);
    const [r] = await db.query(
      `INSERT INTO usuarios (nombre, email, email_verificado, password_hash, telefono, cedula, codigo_ref, rol, verificacion, registro_ip, created_at, ultimo_acceso)
       VALUES (?,?,NOW(),?,?,?,?,?,?,?, NOW() - INTERVAL ? DAY, ?)`,
      [
        nombre,
        email,
        hash,
        telefono(i),
        cedula(i),
        generarCodigoRef(),
        esAliado ? "SOCIO" : "CLIENTE",
        i % 4 === 0 ? "VERIFICADO" : "NO_VERIFICADO",
        IPS(i),
        30 - (i % 25),
        i % 6 === 0 ? new Date() : null, // algunos aparecen "en línea"
      ]
    );
    idPorIndice[i] = r.insertId;
  }

  console.log("🏪 Aliados y productos (descargando fotos, puede tardar un minuto)…");
  let lock = 0;
  const productosPorSocio = {};
  for (const [idx, nombre, categoria, plan, impulso, estado, descripcion, direccion, horario, instagram, productos] of NEGOCIOS) {
    const slug = await slugUnico("socios", nombre);
    const logo = await foto(`logo-${slug}`, productos[0]?.[2] ?? "shop", 300, 300, lock++);
    const pagado = estado === "AL_DIA" ? "CURDATE() + INTERVAL 35 DAY" : estado === "VENCIDO" ? "CURDATE() - INTERVAL 5 DAY" : "NULL";
    const [s] = await db.query(
      `INSERT INTO socios (usuario_id, nombre_negocio, slug, descripcion, categoria, ciudad, direccion, whatsapp, horario, instagram, logo_url, estado, plan, prioridad, destacado_hasta, pagado_hasta)
       VALUES (?,?,?,?,?,'Cúcuta',?,?,?,?,?,?,?,?,${impulso ? `CURDATE() + INTERVAL ${impulso} DAY` : "NULL"},${pagado})`,
      [idPorIndice[idx], nombre, slug, descripcion, categoria, direccion, telefono(idx), horario, instagram, logo, estado === "PENDIENTE" ? "PENDIENTE" : "APROBADO", plan, plan === "PREMIUM" ? 50 : 0]
    );
    productosPorSocio[s.insertId] = [];
    for (const [j, [pn, precio, kw, pd]] of productos.entries()) {
      const img = await foto(`${slug}-${j}`, kw, 640, 640, lock++);
      const agotado = j === productos.length - 1 && productos.length > 3; // el último de algunos, agotado
      const [p] = await db.query(
        "INSERT INTO productos (socio_id, nombre, descripcion, precio, stock, disponible, maneja_stock, imagen_url, destacado) VALUES (?,?,?,?,?,?,?,?,?)",
        [s.insertId, pn, pd, precio, j === 1 ? 3 : 0, agotado ? 0 : 1, j === 1 ? 1 : 0, img, j === 0 ? 1 : 0]
      );
      productosPorSocio[s.insertId].push({ id: p.insertId, precio });
    }
    process.stdout.write(".");
  }
  console.log("");

  console.log("🧾 Pedidos…");
  const clientes = Object.entries(idPorIndice).filter(([i]) => !NEGOCIOS.some((n) => n[0] === Number(i))).map(([, id]) => id);
  const socios = Object.entries(productosPorSocio).filter(([, ps]) => ps.length);
  const ESTADOS = ["PENDIENTE", "PAGADO", "ENVIADO", "ENTREGADO", "ENTREGADO", "CANCELADO"];
  for (let k = 0; k < 24; k++) {
    const [socioId, ps] = socios[k % socios.length];
    const items = ps.slice(0, 1 + (k % Math.min(3, ps.length)));
    const total = items.reduce((a, p, n) => a + p.precio * (1 + (n % 2)), 0);
    const [ped] = await db.query("INSERT INTO pedidos (usuario_id, socio_id, total, estado, nota, created_at) VALUES (?,?,?,?,?, NOW() - INTERVAL ? HOUR)", [
      clientes[k % clientes.length],
      socioId,
      total,
      ESTADOS[k % ESTADOS.length],
      k % 3 === 0 ? "Por favor llamar antes de llegar." : null,
      k * 7,
    ]);
    await db.query("INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ?", [items.map((p, n) => [ped.insertId, p.id, 1 + (n % 2), p.precio])]);
  }

  console.log("🎁 Referidos…");
  // [quien invita, [invitados], cuántos validados HOY]
  const RED = [
    [1, [2, 4, 8, 10, 13], 3], // Ricardo: 5 invitados, 3 validados hoy -> gana el reto del día
    [9, [14, 16, 17], 0], // José
    [24, [25, 26, 27], 1], // Olivia
    [7, [28, 29], 0], // Felipe (aliado) también refiere
  ];
  for (const [quien, invitados, hoy] of RED) {
    for (const [n, inv] of invitados.entries()) {
      const pendiente = quien === 1 && n === invitados.length - 1; // uno por confirmar
      const sospechoso = quien === 24 && n === 2; // uno marcado para revisión
      const validoHoy = n < hoy;
      await db.query("UPDATE usuarios SET referido_por = ? WHERE id = ?", [idPorIndice[quien], idPorIndice[inv]]);
      await db.query(
        `INSERT INTO referidos (referidor_id, referido_id, estado, sospechoso, motivo, validado_en, created_at)
         VALUES (?,?,?,?,?, ${pendiente || sospechoso ? "NULL" : validoHoy ? "NOW()" : "NOW() - INTERVAL 2 DAY"}, NOW() - INTERVAL 3 DAY)`,
        [idPorIndice[quien], idPorIndice[inv], pendiente || sospechoso ? "PENDIENTE" : "VALIDO", sospechoso ? 1 : 0, sospechoso ? "3 cuentas desde la misma IP en 24 h" : null]
      );
    }
    await evaluarPremios(idPorIndice[quien]);
  }

  console.log("🪪 Verificaciones pendientes (fotos de ejemplo)…");
  for (const idx of [2, 5, 26]) {
    const uid = idPorIndice[idx];
    const carpeta = path.join(CARPETA_PRIVADA, String(uid));
    await fs.mkdir(carpeta, { recursive: true });
    const nombres = {};
    for (const [tipo, kw] of [["selfie", "portrait smiling"], ["frente", "identity card"], ["reverso", "document paper"]]) {
      const buf = await fotoJpeg(kw, idx);
      const nombre = `${tipo}-demo-${idx}.jpg`;
      if (buf) await fs.writeFile(path.join(carpeta, nombre), buf);
      nombres[tipo] = buf ? nombre : null;
    }
    await db.query(
      "INSERT INTO verificaciones (usuario_id, cedula, selfie, cedula_frente, cedula_reverso, consentimiento_en, ip) VALUES (?,?,?,?,?,NOW(),?)",
      [uid, cedula(idx), nombres.selfie, nombres.frente, nombres.reverso, IPS(idx)]
    );
    await db.query("UPDATE usuarios SET verificacion = 'PENDIENTE' WHERE id = ?", [uid]);
  }

  console.log("📰 Noticias…");
  for (const [n, [titulo, categoria, kw, resumen]] of NOTICIAS.entries()) {
    const img = await foto(`noticia-${n}`, kw, 1200, 675, n);
    await db.query(
      `INSERT INTO noticias (slug, titulo, resumen, contenido, categoria, imagen_url, destacada, estado, fuente, publicada_en)
       VALUES (?,?,?,?,?,?,?,'PUBLICADA','DEMO', NOW() - INTERVAL ? HOUR)`,
      [await slugUnico("noticias", titulo), titulo, resumen, `${resumen}\n\nEste es un texto de demostración de Televentas Fest. Aquí va el desarrollo completo de la noticia, con declaraciones, cifras y el contexto que necesita el lector.\n\nTV Frontera seguirá informando sobre este tema.`, categoria, img, n === 0 ? 1 : 0, n * 9 + 1]
    );
  }

  console.log("✉️  Suscriptores…");
  for (const [n, email] of EMAILS.slice(0, 20).entries()) {
    const crypto = await import("node:crypto");
    await db.query("INSERT IGNORE INTO suscriptores (email, token_baja, activo, origen, baja_en) VALUES (?,?,?,?,?)", [
      email,
      crypto.randomBytes(32).toString("base64url"),
      n < 18 ? 1 : 0,
      n % 3 ? "inicio" : "noticias",
      n < 18 ? null : new Date(),
    ]);
  }

  console.log(`\n✅ Demo lista: ${PERSONAS.length} usuarios (${NEGOCIOS.length} aliados), pedidos, referidos, noticias y suscriptores.`);
  console.log(`   Contraseña de todas las cuentas demo: ${CLAVE}`);
}

const accion = process.argv[2];
try {
  if (accion === "crear") await crear();
  else if (accion === "borrar") await borrar();
  else console.log("Uso: npm run demo -- crear | borrar");
} finally {
  await db.end();
}
