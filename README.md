# Televentas Fest · API (backend)

API REST de **Televentas Fest**, la gran tienda virtual de **TV Frontera** (canal de televisión de Cúcuta, Colombia).
Maneja usuarios, Puntos Aliados (negocios), productos, noticias, el programa de referidos con premios, la verificación de identidad, el boletín y todo el contenido editable del sitio.

El frontend vive en otro repositorio: **`tvfrontera-web`** (Next.js). La web reenvía `/api/*` y `/uploads/*` a esta API, así que el navegador nunca la llama directamente.

---

## Contenido

1. [Tecnologías](#tecnologías)
2. [Arquitectura](#arquitectura)
3. [Instalación local](#instalación-local)
4. [Variables de entorno](#variables-de-entorno)
5. [Scripts](#scripts)
6. [Estructura del proyecto](#estructura-del-proyecto)
7. [Base de datos](#base-de-datos)
8. [Reglas de negocio](#reglas-de-negocio)
9. [Seguridad](#seguridad)
10. [Referencia de la API](#referencia-de-la-api)
11. [Correo electrónico](#correo-electrónico)
12. [Despliegue](#despliegue)
13. [Solución de problemas](#solución-de-problemas)

---

## Tecnologías

| | |
|---|---|
| Lenguaje | Node.js ≥ 22, JavaScript con ES Modules |
| Framework | Express 5 |
| Base de datos | MySQL 8 / MariaDB 10.4+ (`mysql2/promise`, consultas parametrizadas) |
| Validación | Zod 4 |
| Autenticación | JWT en cookie `httpOnly` + contraseñas con bcrypt |
| Seguridad HTTP | Helmet, CORS con lista blanca, `express-rate-limit` |
| Correo | Resend (API HTTPS) en producción · SMTP con Nodemailer en desarrollo |

## Arquitectura

```
Navegador ──► tvfrontera-web (Next.js) ──► tvfrontera-api (Express) ──► MySQL
               · páginas públicas en caché      · lógica y validación
               · /api/* y /uploads/* se         · disco: uploads/ (público)
                 reenvían a la API                     privado/ (verificaciones)
                       ▲                                   │
                       └──── POST /api/revalidar ◄─────────┘
                        (la API avisa a la web que refresque su caché
                         cuando el admin o un aliado cambia algo)
```

- **Mismo dominio para todo.** El navegador solo habla con la web. La cookie de sesión es del propio sitio, sin problemas de cookies de terceros, y la API puede quedar sin dirección pública.
- **Caché con aviso inmediato.** La web guarda en caché el contenido público hasta 60 segundos. Cuando algo cambia, `avisarWeb(...etiquetas)` (en `src/utils.js`) llama a la web con un secreto compartido para que lo actualice al instante. Etiquetas: `avisos`, `noticias`, `aliados`, `productos`, `secciones`, `programacion`, `sitio`, `referidos`, `categorias`, `preguntas`.
- **Hora de Colombia.** Cada conexión a la base usa `time_zone = '-05:00'`, así que `NOW()` y `CURDATE()` siguen la hora de Colombia aunque el servidor esté en otro país.

## Instalación local

**Requisitos:** Node.js 22 o superior, y XAMPP (MariaDB) o MySQL 8.

```powershell
# 1. Dependencias
npm install

# 2. Base de datos vacía (XAMPP encendido)
mysql -u root -e "CREATE DATABASE tvfrontera CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root tvfrontera < sql/000_esquema_completo.sql

# 3. Configuración: el archivo .env ya viene listo para trabajar en local.
#    Los secretos vacíos usan claves de desarrollo automáticas (ver "Variables de entorno").

# 4. Primer administrador
npm run crear-admin -- "Nombre Apellido" admin@tudominio.com "UnaClaveLarga123"

# 5. Arrancar
npm run dev        # http://localhost:4000
```

Para comprobarlo, abre http://localhost:4000/api/health. Debe responder `{"ok":true,"db":true}`.

> **Datos de prueba (opcional):** `npm run demo -- crear` crea aliados, productos, usuarios, pedidos, referidos y noticias de ejemplo (contraseña común: `Televentas2026*`), sin enviar correos. `npm run demo -- borrar` los elimina.

Para generar un secreto seguro:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Variables de entorno

Un solo archivo: **`.env`**. Se sube al repositorio con los valores de desarrollo y **sin secretos**.

- **En tu PC** funciona tal cual. Si `AUTH_SECRET` o `REVALIDATE_SECRET` están vacíos, se usa una clave de desarrollo automática.
- **En producción** (`NODE_ENV=production` o Railway), los valores reales se ponen en el panel de variables del hosting, que tiene prioridad sobre el `.env`. Ahí los secretos son **obligatorios**: sin ellos la API no arranca.
- **Nunca** escribas contraseñas reales en `.env`. Git guarda el historial, y una clave subida una vez queda en él aunque después la borres.
- Si necesitas claves propias solo en tu PC, por ejemplo la contraseña de Gmail, ponlas en `.env.local`, que no se sube.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | — | `production` en el servidor (activa la cookie segura y la configuración de proxy) |
| `PORT` | — | Puerto de la API (por defecto `4000`) |
| `AUTH_SECRET` | ✅ | Firma de las sesiones JWT. Mínimo 32 caracteres. **Distinto en cada entorno.** |
| `REVALIDATE_SECRET` | ✅ | Secreto compartido con la web para refrescar su caché. Debe ser **igual** en la web. |
| `APP_URL` | ✅ | URL pública del sitio, para los enlaces de los correos. Ej.: `https://tudominio.com` |
| `CORS_ORIGINS` | ✅ | Orígenes permitidos, separados por coma y sin `/` final |
| `DATABASE_URL` | — | `mysql://usuario:clave@host:puerto/base`. Tiene prioridad sobre `DB_*` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | Conexión por partes (por defecto la de XAMPP: `127.0.0.1:3306`, `root`, sin clave, `tvfrontera`) |
| `DATA_DIR` | — | Carpeta persistente para `uploads/` y `privado/`. En Railway: `/data` |
| `COOKIE_SAMESITE` `COOKIE_SECURE` `COOKIE_DOMAIN` | — | Cookie de sesión. Producción: `lax`, `true`, vacío |
| `TRUST_PROXY` | — | Número de proxies de confianza, para obtener la IP real (por defecto `1` en producción) |
| `RESEND_API_KEY` | prod. | Clave de [Resend](https://resend.com). Si existe, los correos salen por HTTPS y se ignora el SMTP |
| `MAIL_FROM` | ✅ | Remitente, ej.: `Televentas Fest <no-responder@tudominio.com>` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | dev. | SMTP para desarrollo (Gmail con contraseña de aplicación) |
| `API_URL` | — | URL pública desde la que se sirven `/uploads` (fotos importadas de Facebook) |
| `CONTACTO_PUBLICO_ALIADOS` | — | `true` muestra el WhatsApp, teléfono y dirección de los aliados sin iniciar sesión (por defecto `false`) |
| `EXIGIR_VERIFICACION_ALIADO` | — | `true` exige identidad verificada para ser Punto Aliado |
| `TURNSTILE_SECRET` | — | Anti-robots Cloudflare Turnstile (vacío = desactivado) |
| `FB_PAGE_ID` `FB_PAGE_TOKEN` `FB_SYNC_MINUTOS` | — | Importar publicaciones de la página de Facebook como noticias (vacío = desactivado) |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo, con reinicio automático al guardar (`node --watch`) |
| `npm start` | Producción |
| `npm run crear-admin -- "Nombre" correo "clave"` | Crea o promueve un usuario a administrador |
| `npm run probar-correo -- destino@correo.com` | Envía un correo de prueba y explica en español cualquier error SMTP |
| `npm run demo -- crear` / `borrar` | Crea o elimina los datos de demostración |

## Estructura del proyecto

```
tvfrontera-api/
├── src/
│   ├── server.js          # arranque, conexión inicial, apagado ordenado
│   ├── app.js             # middlewares globales, CORS, anti-CSRF, montaje de rutas
│   ├── config.js          # lectura y validación de variables de entorno
│   ├── db.js              # pool MySQL (zona horaria de Colombia)
│   ├── mail.js            # envío de correos (Resend / SMTP) y plantillas HTML
│   ├── referidos.js       # motor del programa de referidos y premios
│   ├── facebook.js        # importador opcional de publicaciones de Facebook
│   ├── schemas.js         # esquemas Zod compartidos
│   ├── utils.js           # reglas SQL reutilizables, slugs, paginación, avisarWeb()
│   ├── middleware/
│   │   ├── auth.js        # requireAuth(rol), authOptional, sesión por cookie
│   │   ├── socio.js       # carga el negocio del aliado y exige que esté al día
│   │   ├── antibot.js     # campo trampa, tiempo mínimo, Turnstile
│   │   └── errors.js      # validate(zod), 404 y manejador de errores
│   └── routes/            # un archivo por módulo (ver "Referencia de la API")
├── sql/
│   └── 000_esquema_completo.sql   # instalación desde cero (estructura + configuración inicial)
├── scripts/               # crear-admin, probar-correo, demo
├── docs/DESPLIEGUE.md     # guía de publicación paso a paso (Railway + dominio)
├── .env                   # configuración de desarrollo, sin secretos (único archivo de variables)
├── railway.json           # configuración de despliegue en Railway
├── uploads/               # archivos públicos (ignorado por git)
└── privado/               # fotos de verificación, NUNCA públicas (ignorado por git)
```

## Base de datos

Codificación `utf8mb4` / `utf8mb4_unicode_ci` en todas las tablas.

| Tabla | Contenido |
|---|---|
| `usuarios` | Cuentas (`CLIENTE`, `SOCIO`, `ADMIN`), estado de verificación, `sesion_version`, `ultimo_acceso`, código de referido |
| `socios` | Negocios (Puntos Aliados): datos, contacto, categoría, plan `BASICO`/`PREMIUM`, `pagado_hasta`, `destacado_hasta`, `prioridad` |
| `pagos_socios` | Historial de mensualidades registradas por el admin |
| `productos` | Productos de cada aliado: precio, `disponible`, `maneja_stock`, `stock`, `destacado` |
| `pedidos` · `pedido_items` | Pedidos por la web, uno por aliado (función apagada por ahora: se pide por WhatsApp) |
| `categorias` | Categorías de la tienda con ícono y orden |
| `noticias` | Noticias con categoría, video opcional, fuente (`MANUAL`, `FACEBOOK`, `DEMO`) |
| `secciones` | Bloques de la portada: orden, visibilidad y bloques promocionales con cuenta regresiva |
| `programacion` | Parrilla de programación del canal |
| `anuncios` · `ajustes` | Cinta de avisos y ajustes generales (clave/valor) |
| `preguntas_frecuentes` | Centro de ayuda (FAQ) |
| `referidos` | Quién invitó a quién, estado (`PENDIENTE`, `VALIDO`, `RECHAZADO`), marca de sospechoso e IP |
| `premios_metas` · `retos_semana` · `retos_fecha` · `premios_ganados` | Metas con cupo, reto por día de la semana o por fecha, y ganadores |
| `verificaciones` | Solicitudes de verificación de identidad (las fotos están en disco, no en la base) |
| `email_verificaciones` · `password_resets` | Tokens de un solo uso (se guarda solo su hash SHA-256) |
| `suscriptores` · `boletin_envios` | Boletín: suscriptores con token de baja y registro de envíos |
| `visitas` | Contador de visitas |

**Instalación nueva:** `sql/000_esquema_completo.sql`, que incluye todo y no tiene datos personales.
**Cambios futuros:** crea `sql/001_descripcion.sql` (luego `002_…`), aplícalo en cada entorno **antes** de publicar el código que lo usa, y actualiza `000_esquema_completo.sql`.

## Reglas de negocio

**Aliado visible.** Un Punto Aliado y sus productos aparecen en el sitio solo si está `APROBADO` y su mensualidad está al día (`pagado_hasta >= hoy`). Si deja de pagar, desaparece solo, sin que se borre nada (`SOCIO_VIGENTE_SQL`).

**Posicionamiento.** Con muchos aliados, el orden es:
1. Impulso pagado vigente (`destacado_hasta`).
2. Plan Premium.
3. Prioridad manual del admin (0–100).
4. Rotación diaria estable (CRC32 de id + fecha), para dar exposición justa sin que la paginación repita aliados.

En el catálogo, los productos salen "por rondas": el mejor de cada aliado primero.

**Productos.** Al público nunca se le muestra el stock: solo *Disponible*, *¡Últimas unidades!* o *Agotado*. Los productos los gestiona cada aliado; el admin no puede editarlos. Productos recomendados por plan: Básico 2, Premium 8.

**Pedidos.** Hoy se piden **por WhatsApp**: la web arma el mensaje y requiere sesión iniciada. El flujo de pedidos por la web (`/api/pedidos`) sigue en el código: crea un pedido por aliado y el aliado lo pasa por `PAGADO → ENVIADO → ENTREGADO`. Se activa desde la web con `NEXT_PUBLIC_COMPRAS_WEB=true`. El admin solo supervisa; no compra ni vende.

**Contacto de los aliados.** El WhatsApp, el teléfono y la dirección nunca van en respuestas públicas ni en la caché. Solo se entregan con sesión iniciada, salvo que `CONTACTO_PUBLICO_ALIADOS=true`.

**Referidos y premios** (`src/referidos.js`):
- Cada usuario tiene un código. Un referido cuenta cuando cumple el requisito configurado: `EMAIL` (confirmar correo), `IDENTIDAD` (verificación aprobada) o `COMPRA` (pedido entregado).
- Se marcan como sospechosos los registros desde la misma IP y los correos desechables.
- Hay metas con cupo ("los primeros X que lleguen a N referidos") y retos diarios, por día de la semana o por fecha concreta.
- Un bloqueo de base de datos (`GET_LOCK`) evita que dos personas ganen el mismo cupo al mismo tiempo.

**Verificación de identidad:**
- El usuario envía una selfie en vivo y las dos caras de la cédula, con consentimiento expreso para datos biométricos (Ley 1581).
- Se aceptan solo JPEG reales (se revisan los bytes de firma) de máximo 3 MB.
- Las fotos se guardan con nombres aleatorios en `privado/verificaciones/<usuario>/`. Solo el admin puede verlas, siempre sin caché.
- El admin aprueba o rechaza manualmente con un motivo, y después puede borrar las fotos.

**Sesión y estado "en línea".** Si un usuario cambia su contraseña, se incrementa `sesion_version` y se cierran sus otras sesiones. Un usuario aparece "en línea" si tuvo actividad en los últimos 5 minutos (la web envía una señal cada 2 minutos).

## Seguridad

- **Contraseñas:** bcrypt. Los tokens de correo y de restablecimiento se guardan solo como hash SHA-256, con vencimiento y uso único.
- **Sesión:** JWT en cookie `httpOnly` y `SameSite=Lax` (`Secure` en producción). En cada petición se vuelve a leer el usuario desde la base, así que un usuario desactivado pierde el acceso de inmediato.
- **CORS y CSRF:** CORS con lista blanca y `credentials`. Además, cualquier `POST/PUT/PATCH/DELETE` con un `Origin` que no esté en la lista se rechaza con 403.
- **Límites por IP** en registro, login, correos, verificación y boletín. `trust proxy` está configurado para leer la IP real detrás del proxy.
- **Anti-robots:** campo trampa (`sitio_web`), tiempo mínimo para llenar el formulario (`t_formulario` ≥ 3 s), Cloudflare Turnstile opcional y bloqueo de correos desechables.
- **Validación:** todas las entradas pasan por esquemas Zod, y todo el SQL va parametrizado.
- **Cabeceras:** Helmet. Los cuerpos JSON se limitan a 100 KB, salvo la subida de fotos de verificación (12 MB).
- **Datos sensibles:** las fotos de verificación nunca se exponen en rutas públicas, y los datos de contacto de los aliados solo se entregan con sesión.
- **Secretos:** solo en las variables del hosting. El `.env` del repositorio no lleva claves, y en producción la API se niega a arrancar sin ellas. `uploads/` y `privado/` están en `.gitignore`.

## Referencia de la API

Todas las rutas empiezan con `/api`. Niveles de acceso: 🌐 público · 👤 con sesión · 🏪 aliado (`SOCIO`) · 🛡️ administrador.
Los errores responden `{ "error": "mensaje en español" }` con el código HTTP correspondiente.

### Salud y visitas
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/health` | 🌐 | Estado de la API y la base de datos |
| GET / POST | `/visitors` | 🌐 | Leer / sumar una visita |

### Autenticación — `/auth`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/registro` | 🌐 | Crear cuenta (cliente o aliado). Anti-robots y código de referido opcional |
| POST | `/login` · `/logout` | 🌐 · 👤 | Iniciar / cerrar sesión |
| GET · PATCH | `/me` | 👤 | Datos de la sesión / editar el perfil |
| POST | `/ping` | 👤 | Señal de actividad (estado "en línea") |
| POST | `/password` | 👤 | Cambiar la contraseña (cierra las otras sesiones) |
| POST | `/recuperar` · `/restablecer` | 🌐 | Pedir el enlace / crear una contraseña nueva |
| POST | `/confirmar` · `/reenviar-confirmacion` | 🌐 · 👤 | Confirmar el correo / reenviar el enlace |

### Puntos Aliados — `/socios`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/` | 🌐 | Directorio (búsqueda, categoría, paginación, posicionamiento) |
| GET | `/categorias` | 🌐 | Categorías con aliados vigentes y su conteo |
| GET | `/:slug` | 🌐 | Tienda del aliado; el contacto solo se incluye con sesión |
| POST | `/solicitud` | 👤 | Un cliente solicita ser Punto Aliado |
| GET · PUT | `/me` | 🏪 | Ver / editar mi negocio |

### Productos — `/productos`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/` | 🌐 | Catálogo (`q`, `categoria`, `destacados`, paginación) |
| GET | `/mios` | 🏪 | Mis productos |
| POST · PUT · DELETE | `/` · `/:id` | 🏪 | Crear / editar / borrar (solo el dueño) |

### Pedidos — `/pedidos` (compra por la web, actualmente desactivada en la web)
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/` | 👤 | Crear pedido(s), uno por aliado; precios tomados de la base |
| GET | `/` | 👤 | Mis compras |
| PATCH | `/:id/cancelar` | 👤 | Cancelar mientras está pendiente |
| GET · PATCH | `/ventas` · `/ventas/:id` | 🏪 | Pedidos recibidos / cambiar estado |

### Noticias — `/noticias`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/` · `/:slug` | 🌐 | Listado (categoría, búsqueda, paginación) / detalle |
| GET | `/admin/todas` · `/admin/:id` | 🛡️ | Incluye borradores |
| POST · PUT · DELETE | `/` · `/:id` | 🛡️ | Crear / editar / borrar |
| GET · POST | `/admin/facebook` · `/admin/facebook/sincronizar` | 🛡️ | Estado e importación manual desde Facebook |

### Contenido editable
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/secciones` | 🌐 | Bloques visibles de la portada |
| GET · POST · PUT · DELETE | `/secciones/admin` · `/secciones` · `/secciones/orden` · `/secciones/:id` | 🛡️ | Administrar bloques y promociones |
| GET | `/programacion` | 🌐 | Programación del canal |
| GET · POST · PUT · DELETE | `/programacion/admin` · `/programacion` · `/programacion/:id` | 🛡️ | Administrar la programación |
| GET · PUT | `/sitio` | 🌐 · 🛡️ | Textos del sitio (ej. historia de "Quiénes somos") |
| GET | `/anuncios` | 🌐 | Cinta de avisos activa |
| GET · POST · PUT · DELETE | `/anuncios/admin` · `/anuncios` · `/anuncios/ajustes` · `/anuncios/:id` | 🛡️ | Administrar avisos |
| GET | `/categorias` | 🌐 | Categorías activas |
| GET · POST · PUT · DELETE | `/categorias/admin` · `/categorias` · `/categorias/orden` · `/categorias/:id` | 🛡️ | Administrar categorías (renombrar actualiza los negocios; no se borra si está en uso) |
| GET | `/preguntas` | 🌐 | Preguntas frecuentes activas |
| GET · POST · PUT · DELETE | `/preguntas/admin` · `/preguntas` · `/preguntas/orden` · `/preguntas/:id` | 🛡️ | Administrar preguntas frecuentes |

### Referidos — `/referidos`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/programa` | 🌐 | Reto del día, metas y ranking semanal |
| GET | `/codigo/:codigo` | 🌐 | Validar un código de invitación |
| GET | `/mio` | 👤 | Mi enlace, mis referidos y mis premios |
| GET | `/admin/resumen` · `/admin/lista` · `/admin/ganadores` | 🛡️ | Supervisión y antifraude |
| GET · POST · PUT · DELETE | `/admin/metas` · `/admin/metas/:id` | 🛡️ | Metas con cupo |
| GET · PUT · DELETE | `/admin/retos` · `/admin/retos/semana/:dia` · `/admin/retos/fecha/:fecha` | 🛡️ | Retos por día de la semana o por fecha |

### Verificación de identidad — `/verificacion`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/fotos` | 👤 | Enviar selfie + cédula (frente y reverso) con consentimiento |
| GET | `/mia` | 👤 | Estado de mi verificación |
| GET | `/admin` | 🛡️ | Solicitudes por estado |
| GET | `/admin/:id/foto/:tipo` | 🛡️ | Ver una foto (`selfie`, `frente`, `reverso`), sin caché |
| PATCH | `/admin/:id` | 🛡️ | Aprobar o rechazar (con motivo); avisa por correo |
| DELETE | `/admin/:id/fotos` | 🛡️ | Borrar las fotos de una solicitud ya revisada |

### Boletín — `/suscriptores`
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/` | 🌐 | Suscribirse (anti-robots) |
| POST | `/baja` | 🌐 | Darse de baja con el token del correo |
| GET · DELETE | `/` · `/:id` | 🛡️ | Lista de suscriptores |
| POST · GET | `/enviar` · `/envios` | 🛡️ | Enviar un boletín con noticias / historial de envíos |

### Administración — `/admin` (todo 🛡️)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/resumen` | Indicadores del panel (en línea, pendientes, ventas, etc.) |
| GET · PATCH | `/socios` · `/socios/:id` | Aliados: aprobar, plan, impulso, prioridad, estado |
| GET · POST | `/socios/:id/pagos` | Registrar mensualidades (extiende `pagado_hasta`) |
| GET · PATCH | `/usuarios` · `/usuarios/:id` | Usuarios: rol, activación |
| GET | `/pedidos` | Supervisión de todos los pedidos |

## Correo electrónico

`src/mail.js` elige el método automáticamente:

1. **Resend**, si existe `RESEND_API_KEY`. Recomendado en producción: muchos hostings, Railway Hobby incluido, bloquean los puertos SMTP. Hay que verificar el dominio en Resend (registros SPF y DKIM).
2. **SMTP**, si existe `SMTP_HOST`. Para desarrollo con Gmail y una contraseña de aplicación.
3. **Ninguno:** en desarrollo, los enlaces de los correos se imprimen en la consola.

Un fallo de correo nunca rompe la petición: se registra en la consola y la API sigue funcionando.
Correos que se envían: confirmación de cuenta, recuperación de contraseña, resultado de la verificación, avisos de premios y boletín (con `List-Unsubscribe`).

## Despliegue

La guía completa, paso a paso, está en **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)** (Railway + dominio de Namecheap con DNS en Cloudflare + Resend).
`railway.json` ya define el comando de inicio, la ruta de salud (`/api/health`) y el reinicio automático.

Lista mínima para producción:
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, secretos nuevos y únicos.
- [ ] `CORS_ORIGINS` y `APP_URL` con el dominio real (HTTPS).
- [ ] Disco persistente en `DATA_DIR`.
- [ ] `RESEND_API_KEY` con el dominio verificado.
- [ ] Respaldo periódico de la base de datos.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `No se pudo conectar a MySQL` | Enciende MySQL en XAMPP, o revisa `DATABASE_URL` / `DB_*` |
| No llegan correos en local | Normal si `SMTP_PASS` está vacío: los enlaces aparecen en la consola de la API. Para enviar de verdad, pon `SMTP_USER` y `SMTP_PASS` en un `.env.local` |
| `Falta la variable de entorno AUTH_SECRET (obligatoria en producción)` | Define `AUTH_SECRET` y `REVALIDATE_SECRET` en las variables del hosting |
| `❌ Base de datos no disponible (ECONNREFUSED)` | MySQL está apagado: enciéndelo en XAMPP. Mientras tanto, la API responde 503 sin caerse |
| El login funciona en el PC pero no desde el celular | Entra por la web (`http://IP:3000`), nunca directo a la API. En desarrollo la API acepta sola las IP de la red local |
| `403 Origen no permitido` | Agrega el origen exacto a `CORS_ORIGINS` (protocolo, dominio y puerto, sin `/` final) |
| Gmail: `EAUTH` | `SMTP_USER` debe ser la cuenta dueña de la contraseña de aplicación. Prueba con `npm run probar-correo -- correo` |
| Los cambios del admin tardan en verse | `REVALIDATE_SECRET` debe ser igual en la API y en la web, y `APP_URL` debe apuntar a la web |

---

© TV Frontera · Televentas Fest. Código privado, todos los derechos reservados.
