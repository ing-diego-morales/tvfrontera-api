-- 000_esquema_completo.sql — INSTALACIÓN DESDE CERO de la base de datos de Televentas Fest
-- Incluye la estructura completa (equivale a aplicar todas las migraciones 002 a 008) y la
-- configuración inicial: categorías, secciones de portada, programación, avisos, preguntas
-- frecuentes, retos y ajustes. NO contiene usuarios, aliados, productos ni datos personales.
--
-- Uso (base vacía):  mysql -u root -p tvfrontera < sql/000_esquema_completo.sql
-- Las migraciones 002..008 son solo para actualizar instalaciones antiguas.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `ajustes` (
  `clave` varchar(60) NOT NULL,
  `valor` text NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `anuncios` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `texto` varchar(200) NOT NULL,
  `enlace` varchar(300) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden` smallint(6) NOT NULL DEFAULT 0,
  `desde` datetime DEFAULT NULL,
  `hasta` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_anuncios_activo` (`activo`,`orden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `boletin_envios` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `asunto` varchar(200) NOT NULL,
  `destinatarios` int(10) unsigned NOT NULL DEFAULT 0,
  `enviados` int(10) unsigned NOT NULL DEFAULT 0,
  `fallidos` int(10) unsigned NOT NULL DEFAULT 0,
  `estado` enum('ENVIANDO','TERMINADO') NOT NULL DEFAULT 'ENVIANDO',
  `admin_id` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `terminado_en` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `categorias` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `icono` varchar(30) NOT NULL DEFAULT 'grid',
  `orden` smallint(6) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categorias_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `email_verificaciones` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expira_en` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emailver_token` (`token_hash`),
  KEY `idx_emailver_usuario` (`usuario_id`),
  CONSTRAINT `fk_emailver_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `noticias` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(180) NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `resumen` varchar(400) DEFAULT NULL,
  `contenido` mediumtext DEFAULT NULL,
  `categoria` varchar(40) NOT NULL DEFAULT 'local',
  `imagen_url` varchar(500) DEFAULT NULL,
  `video_url` varchar(500) DEFAULT NULL,
  `fuente` varchar(20) NOT NULL DEFAULT 'MANUAL',
  `fuente_id` varchar(100) DEFAULT NULL,
  `fuente_url` varchar(500) DEFAULT NULL,
  `destacada` tinyint(1) NOT NULL DEFAULT 0,
  `estado` enum('BORRADOR','PUBLICADA') NOT NULL DEFAULT 'BORRADOR',
  `autor_id` int(10) unsigned DEFAULT NULL,
  `publicada_en` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_noticias_slug` (`slug`),
  UNIQUE KEY `uq_noticias_fuente` (`fuente`,`fuente_id`),
  KEY `idx_noticias_pub` (`estado`,`publicada_en`),
  KEY `idx_noticias_cat` (`categoria`),
  KEY `fk_noticias_autor` (`autor_id`),
  CONSTRAINT `fk_noticias_autor` FOREIGN KEY (`autor_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `pagos_socios` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `socio_id` int(10) unsigned NOT NULL,
  `monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `meses` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `periodo_desde` date NOT NULL,
  `periodo_hasta` date NOT NULL,
  `metodo` varchar(40) DEFAULT NULL,
  `referencia` varchar(120) DEFAULT NULL,
  `registrado_por` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_pagos_socio` (`socio_id`),
  KEY `fk_pagos_admin` (`registrado_por`),
  CONSTRAINT `fk_pagos_admin` FOREIGN KEY (`registrado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pagos_socio` FOREIGN KEY (`socio_id`) REFERENCES `socios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expira_en` datetime NOT NULL,
  `usado_en` datetime DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reset_token` (`token_hash`),
  KEY `idx_reset_usuario` (`usuario_id`),
  CONSTRAINT `fk_reset_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `pedido_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` int(10) unsigned NOT NULL,
  `producto_id` int(10) unsigned NOT NULL,
  `cantidad` int(10) unsigned NOT NULL,
  `precio_unitario` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `pedido_id` (`pedido_id`),
  KEY `producto_id` (`producto_id`),
  CONSTRAINT `pedido_items_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pedido_items_ibfk_2` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `pedidos` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `socio_id` int(10) unsigned DEFAULT NULL,
  `total` decimal(12,2) NOT NULL,
  `estado` enum('PENDIENTE','PAGADO','ENVIADO','ENTREGADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  `nota` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `fk_pedidos_socio` (`socio_id`),
  CONSTRAINT `fk_pedidos_socio` FOREIGN KEY (`socio_id`) REFERENCES `socios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `pedidos_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `preguntas_frecuentes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `tema` varchar(60) NOT NULL,
  `pregunta` varchar(200) NOT NULL,
  `respuesta` text NOT NULL,
  `orden` int(11) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `actualizado_en` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_faq_orden` (`activo`,`orden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `premios_ganados` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `tipo` enum('META','RETO') NOT NULL,
  `meta_id` int(10) unsigned DEFAULT NULL,
  `fecha_reto` date DEFAULT NULL,
  `premio` varchar(200) NOT NULL,
  `posicion` smallint(5) unsigned DEFAULT NULL,
  `estado` enum('PENDIENTE','ENTREGADO','ANULADO') NOT NULL DEFAULT 'PENDIENTE',
  `notas` varchar(300) DEFAULT NULL,
  `entregado_en` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ganado_meta` (`usuario_id`,`meta_id`),
  UNIQUE KEY `uq_ganado_reto` (`usuario_id`,`fecha_reto`),
  KEY `idx_ganados_estado` (`estado`,`created_at`),
  KEY `fk_ganados_meta` (`meta_id`),
  CONSTRAINT `fk_ganados_meta` FOREIGN KEY (`meta_id`) REFERENCES `premios_metas` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ganados_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `premios_metas` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(500) DEFAULT NULL,
  `imagen_url` varchar(500) DEFAULT NULL,
  `referidos_necesarios` smallint(5) unsigned NOT NULL,
  `cupo` smallint(5) unsigned DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `productos` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `socio_id` int(10) unsigned NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `precio` decimal(12,2) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT 0,
  `disponible` tinyint(1) NOT NULL DEFAULT 1,
  `maneja_stock` tinyint(1) NOT NULL DEFAULT 0,
  `imagen_url` varchar(500) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `destacado` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_productos_socio_destacado` (`socio_id`,`activo`,`destacado`,`created_at`),
  CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`socio_id`) REFERENCES `socios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `programacion` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `titulo` varchar(120) NOT NULL,
  `descripcion` varchar(300) DEFAULT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time DEFAULT NULL,
  `dias` varchar(7) NOT NULL DEFAULT '1234567',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_programacion_hora` (`activo`,`hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `referidos` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `referidor_id` int(10) unsigned NOT NULL,
  `referido_id` int(10) unsigned NOT NULL,
  `estado` enum('PENDIENTE','VALIDO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  `sospechoso` tinyint(1) NOT NULL DEFAULT 0,
  `motivo` varchar(200) DEFAULT NULL,
  `validado_en` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referidos_referido` (`referido_id`),
  KEY `idx_referidos_referidor` (`referidor_id`,`estado`,`validado_en`),
  CONSTRAINT `fk_referidos_referido` FOREIGN KEY (`referido_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_referidos_referidor` FOREIGN KEY (`referidor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `retos_fecha` (
  `fecha` date NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `premio` varchar(200) NOT NULL,
  `descripcion` varchar(500) DEFAULT NULL,
  `referidos_necesarios` smallint(5) unsigned NOT NULL DEFAULT 3,
  `ganadores` smallint(5) unsigned NOT NULL DEFAULT 5,
  PRIMARY KEY (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `retos_semana` (
  `dia` tinyint(3) unsigned NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `premio` varchar(200) NOT NULL,
  `descripcion` varchar(500) DEFAULT NULL,
  `referidos_necesarios` smallint(5) unsigned NOT NULL DEFAULT 3,
  `ganadores` smallint(5) unsigned NOT NULL DEFAULT 5,
  PRIMARY KEY (`dia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `secciones` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `clave` varchar(40) DEFAULT NULL,
  `tipo` enum('SISTEMA','PROMO') NOT NULL DEFAULT 'PROMO',
  `titulo` varchar(150) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden` smallint(6) NOT NULL DEFAULT 0,
  `datos` text DEFAULT NULL,
  `desde` datetime DEFAULT NULL,
  `hasta` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_secciones_clave` (`clave`),
  KEY `idx_secciones_orden` (`activo`,`orden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `socios` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `nombre_negocio` varchar(150) NOT NULL,
  `slug` varchar(160) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `categoria` varchar(80) DEFAULT NULL,
  `ciudad` varchar(100) NOT NULL,
  `direccion` varchar(200) DEFAULT NULL,
  `whatsapp` varchar(30) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `horario` varchar(150) DEFAULT NULL,
  `instagram` varchar(100) DEFAULT NULL,
  `facebook` varchar(200) DEFAULT NULL,
  `logo_url` varchar(500) DEFAULT NULL,
  `estado` enum('PENDIENTE','APROBADO','SUSPENDIDO') NOT NULL DEFAULT 'PENDIENTE',
  `plan` enum('BASICO','PREMIUM') NOT NULL DEFAULT 'BASICO',
  `prioridad` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `destacado_hasta` date DEFAULT NULL,
  `pagado_hasta` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario_id` (`usuario_id`),
  UNIQUE KEY `uq_socios_slug` (`slug`),
  KEY `idx_socios_ranking` (`estado`,`pagado_hasta`,`destacado_hasta`,`plan`,`prioridad`),
  CONSTRAINT `socios_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `suscriptores` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `token_baja` char(43) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `origen` varchar(40) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `baja_en` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_suscriptores_email` (`email`),
  UNIQUE KEY `uq_suscriptores_token` (`token_baja`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `email_verificado` datetime DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `cedula` varchar(20) DEFAULT NULL,
  `codigo_ref` varchar(12) DEFAULT NULL,
  `referido_por` int(10) unsigned DEFAULT NULL,
  `rol` enum('ADMIN','SOCIO','CLIENTE') NOT NULL DEFAULT 'CLIENTE',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `verificacion` enum('NO_VERIFICADO','PENDIENTE','VERIFICADO','RECHAZADO') NOT NULL DEFAULT 'NO_VERIFICADO',
  `verificacion_ref` varchar(120) DEFAULT NULL,
  `sesion_version` int(10) unsigned NOT NULL DEFAULT 0,
  `ultimo_acceso` datetime DEFAULT NULL,
  `registro_ip` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `uq_usuarios_cedula` (`cedula`),
  UNIQUE KEY `uq_usuarios_codigo_ref` (`codigo_ref`),
  KEY `idx_usuarios_ultimo_acceso` (`ultimo_acceso`),
  KEY `idx_usuarios_referido_por` (`referido_por`),
  KEY `idx_usuarios_registro_ip` (`registro_ip`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `verificaciones` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` int(10) unsigned NOT NULL,
  `cedula` varchar(20) NOT NULL,
  `estado` enum('PENDIENTE','APROBADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
  `selfie` varchar(120) DEFAULT NULL,
  `cedula_frente` varchar(120) DEFAULT NULL,
  `cedula_reverso` varchar(120) DEFAULT NULL,
  `consentimiento_en` datetime NOT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `motivo` varchar(300) DEFAULT NULL,
  `revisado_por` int(10) unsigned DEFAULT NULL,
  `revisado_en` datetime DEFAULT NULL,
  `fotos_borradas` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_verif_estado` (`estado`,`created_at`),
  KEY `idx_verif_usuario` (`usuario_id`),
  KEY `fk_verif_admin` (`revisado_por`),
  CONSTRAINT `fk_verif_admin` FOREIGN KEY (`revisado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_verif_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `visitas` (
  `id` tinyint(3) unsigned NOT NULL,
  `total` bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- ---------- Configuración inicial ----------
INSERT  IGNORE INTO `ajustes` VALUES ('avisos_activos','1','2026-11-17 02:06:58');
INSERT  IGNORE INTO `ajustes` VALUES ('avisos_titulo','Avisos','2026-11-14 17:26:31');
INSERT  IGNORE INTO `ajustes` VALUES ('facebook_categoria','local','2026-11-17 02:23:43');
INSERT  IGNORE INTO `ajustes` VALUES ('facebook_publicar','0','2026-11-17 02:23:43');
INSERT  IGNORE INTO `ajustes` VALUES ('m006_correos','1','2026-11-17 02:23:43');
INSERT  IGNORE INTO `ajustes` VALUES ('nosotros_historia','TV Frontera nació con un propósito claro: darle voz a la gente de la frontera. Desde Cúcuta llevamos noticias, cultura y entretenimiento a miles de hogares de Norte de Santander.\n\nHoy somos un medio que combina la televisión con el mundo digital: transmitimos en vivo, publicamos noticias al instante y, con Televentas Fest, conectamos a los negocios de la región con toda nuestra audiencia.','2026-11-17 02:11:53');
INSERT  IGNORE INTO `ajustes` VALUES ('referidos_activo','1','2026-11-17 02:23:43');
INSERT  IGNORE INTO `ajustes` VALUES ('referidos_requisito','EMAIL','2026-11-17 02:29:16');
INSERT  IGNORE INTO `secciones` VALUES (1,'tienda','SISTEMA','Buscador y categorías de la tienda',1,10,NULL,NULL,NULL,'2026-11-17 02:29:46');
INSERT  IGNORE INTO `secciones` VALUES (2,'vitrina','SISTEMA','Vitrina de productos recomendados',1,40,NULL,NULL,NULL,'2026-11-17 02:29:50');
INSERT  IGNORE INTO `secciones` VALUES (3,'aliados','SISTEMA','Puntos Aliados',1,50,NULL,NULL,NULL,'2026-11-17 02:29:51');
INSERT  IGNORE INTO `secciones` VALUES (4,'noticias','SISTEMA','Lo último (noticias)',1,60,NULL,NULL,NULL,'2026-11-17 02:29:51');
INSERT  IGNORE INTO `secciones` VALUES (5,'servicio','SISTEMA','Pico y Placa + Programación',1,80,NULL,NULL,NULL,'2026-11-17 02:29:52');
INSERT  IGNORE INTO `secciones` VALUES (6,'videos','SISTEMA','Videos',1,90,NULL,NULL,NULL,'2026-11-17 02:29:53');
INSERT  IGNORE INTO `secciones` VALUES (7,'boletin','SISTEMA','Suscripción al boletín',1,100,NULL,NULL,NULL,'2026-11-17 02:29:54');
INSERT  IGNORE INTO `secciones` VALUES (8,'redes','SISTEMA','Síguenos en redes',1,120,NULL,NULL,NULL,'2026-11-17 02:29:55');
INSERT  IGNORE INTO `secciones` VALUES (9,NULL,'PROMO','Gran Tienda Virtual',1,20,'{\"etiqueta\":\"¡Ya llegó!\",\"subtitulo\":\"La Gran Tienda Virtual de Televentas Fest\",\"texto\":\"Pide online fácil, seguro y rápido a los negocios de la región y gana increíbles premios gratis.\",\"imagen_url\":\"/promos/gran-tienda-virtual.webp\",\"boton_texto\":\"Ver productos\",\"boton_enlace\":\"/productos\",\"estilo\":\"naranja\",\"fecha_evento\":null}',NULL,NULL,'2026-11-17 02:29:46');
INSERT  IGNORE INTO `secciones` VALUES (10,NULL,'PROMO','Gran Sorteo Anual Televentas Fest',1,110,'{\"etiqueta\":\"Sorteo anual\",\"subtitulo\":\"Participa y gana premios increíbles\",\"texto\":\"Cada año sorteamos premios entre nuestra comunidad. Edita este bloque desde Admin > Inicio con los premios, requisitos y fecha del sorteo.\",\"imagen_url\":null,\"boton_texto\":\"Quiero participar\",\"boton_enlace\":\"/registro\",\"estilo\":\"indigo\",\"fecha_evento\":null}',NULL,NULL,'2026-11-17 02:29:45');
INSERT  IGNORE INTO `secciones` VALUES (28,'referidos','SISTEMA','Refiere y gana (programa de referidos)',1,30,NULL,NULL,NULL,'2026-11-17 02:29:47');
INSERT  IGNORE INTO `secciones` VALUES (29,'facebook','SISTEMA','Desde Facebook (publicaciones de la página)',1,70,NULL,NULL,NULL,'2026-11-17 02:29:51');
INSERT  IGNORE INTO `programacion` VALUES (1,'Noticiero del Mediodía',NULL,'12:00:00','14:00:00','1234567',1,'2026-11-17 02:00:22','2026-11-17 02:28:25');
INSERT  IGNORE INTO `programacion` VALUES (2,'Magazín Frontera',NULL,'14:00:00','18:00:00','1234567',1,'2026-11-17 02:00:22','2026-11-17 02:00:22');
INSERT  IGNORE INTO `programacion` VALUES (3,'Noticiero Central',NULL,'18:00:00','21:00:00','1234567',1,'2026-11-17 02:00:22','2026-11-17 02:00:22');
INSERT  IGNORE INTO `programacion` VALUES (4,'Televentas Fest',NULL,'21:00:00','23:59:00','1234567',1,'2026-11-17 02:00:22','2026-11-17 02:00:22');
INSERT  IGNORE INTO `categorias` VALUES (1,'Alimentos y bebidas','manzana',10,1);
INSERT  IGNORE INTO `categorias` VALUES (2,'Restaurantes','cubiertos',20,1);
INSERT  IGNORE INTO `categorias` VALUES (3,'Moda y accesorios','camisa',30,1);
INSERT  IGNORE INTO `categorias` VALUES (4,'Tecnología','celular',40,1);
INSERT  IGNORE INTO `categorias` VALUES (5,'Telecomunicaciones','wifi',50,1);
INSERT  IGNORE INTO `categorias` VALUES (6,'Automotriz','carro',60,1);
INSERT  IGNORE INTO `categorias` VALUES (7,'Salud y belleza','salud',70,1);
INSERT  IGNORE INTO `categorias` VALUES (8,'Hogar y ferretería','casa',80,1);
INSERT  IGNORE INTO `categorias` VALUES (9,'Servicios profesionales','maletin',90,1);
INSERT  IGNORE INTO `categorias` VALUES (10,'Educación','libro',100,1);
INSERT  IGNORE INTO `categorias` VALUES (11,'Otro','grid',110,1);
INSERT  IGNORE INTO `categorias` VALUES (29,'Drogas','farmacia',120,1);
INSERT  IGNORE INTO `categorias` VALUES (30,'Veterinaria','mascota',130,1);
INSERT  IGNORE INTO `categorias` VALUES (31,'Gimnasio','deporte',140,1);
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (1,'Compras','¿Cómo compro en Televentas Fest?','Busca el producto que te interesa, entra a la tienda del Punto Aliado y elige los productos y cantidades. Luego toca \"Pedir por WhatsApp\": se abre WhatsApp con tu pedido ya escrito (productos, total y tu nota) para enviárselo directo al negocio, que te confirma la disponibilidad, el pago y la entrega.\n\nNecesitas una cuenta gratuita para pedir. Muy pronto también podrás comprar y pagar directamente en la web.',10,1,'2026-11-19 05:21:38');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (2,'Compras','¿Cómo pago mi pedido?','El pago se acuerda directamente con el Punto Aliado (efectivo, transferencia, Nequi u otros medios que el negocio acepte). Televentas Fest no cobra comisiones al comprador ni guarda datos de tarjetas.',20,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (3,'Compras','¿Hacen envíos a domicilio?','Cada Punto Aliado define sus zonas y costos de entrega. Al confirmar tu pedido, el negocio te indica si hace domicilio a tu dirección, el valor y el tiempo estimado. También puedes recoger en el punto físico si el negocio lo ofrece.',30,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (4,'Compras','¿Puedo cambiar o cancelar un pedido?','Sí. Como el pedido se acuerda por WhatsApp, escríbele al negocio en esa misma conversación para cambiarlo o cancelarlo, idealmente antes de que lo despache.',40,1,'2026-11-19 05:21:38');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (5,'Compras','¿Qué pasa si tengo un problema con un producto?','Cada Punto Aliado responde por sus productos, garantías y facturación. Escríbele primero al negocio; si no recibes respuesta, contáctanos y te ayudamos a mediar.',50,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (6,'Puntos Aliados','¿Cómo vendo mis productos en Televentas Fest?','Crea tu cuenta como \"Punto Aliado\", completa los datos de tu negocio (WhatsApp, dirección y categoría) y envía la solicitud. Nuestro equipo la revisa y, una vez aprobada y activa la mensualidad, tu tienda queda publicada.',60,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (7,'Puntos Aliados','¿Cuánto cuesta ser Punto Aliado?','Manejamos un plan Básico y un plan Premium con mensualidad. El Premium te da más productos recomendados y mejor posición en el catálogo. Escríbenos por WhatsApp o desde la página de contacto y te enviamos la tarifa vigente.',70,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (8,'Puntos Aliados','¿Cómo puedo aparecer primero?','El orden se define por: impulsos destacados vigentes, plan Premium, prioridad asignada por el equipo y una rotación diaria que da exposición justa a todos los negocios al día. Tener fotos claras, precios actualizados y productos disponibles también ayuda a vender más.',80,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (9,'Referidos y premios','¿Cómo funciona \"Refiere y gana\"?','Comparte tu enlace personal desde \"Mi cuenta > Refiere y gana\". Cada persona que se registre con tu enlace y cumpla el requisito vigente (por ejemplo, confirmar su correo) cuenta como referido válido y te acerca a los premios del reto del día y de las metas.',90,1,'2026-11-19 05:09:13');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (10,'Referidos y premios','¿Por qué un referido aparece como pendiente?','Un referido queda pendiente hasta que la persona cumple el requisito (confirmar correo, verificar identidad o hacer una compra, según el reto). Para evitar fraudes, también revisamos registros sospechosos antes de contarlos.',100,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (11,'Referidos y premios','¿Cómo reclamo un premio?','Si ganas, te avisamos por correo y lo verás en \"Mi cuenta\". Nuestro equipo se comunica contigo para coordinar la entrega. Para recibirlo debes tener tus datos completos y, si el premio lo exige, tu identidad verificada.',110,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (12,'Cuenta y seguridad','Olvidé mi contraseña, ¿qué hago?','En la página de ingreso toca \"¿Olvidaste tu contraseña?\" y escribe tu correo. Te enviaremos un enlace para crear una nueva. Por seguridad, al cambiarla se cierran las sesiones abiertas en otros dispositivos.',120,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (13,'Cuenta y seguridad','¿Para qué verifican mi identidad?','La verificación (foto de tu cédula y una selfie) protege a la comunidad contra cuentas falsas y fraudes en premios. Las fotos se guardan de forma privada, solo las revisa el equipo autorizado y puedes pedir su eliminación en cualquier momento, según nuestra Política de privacidad.',130,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (14,'Cuenta y seguridad','¿Mis datos están seguros?','Sí. Tu contraseña se guarda cifrada, la sesión viaja en una cookie protegida y los datos de contacto de los negocios solo se muestran a usuarios registrados. Nunca vendemos tu información.',140,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (15,'TV Frontera','¿Dónde escucho la radio y veo las noticias?','La radio está en vivo en la sección Radio y en el botón flotante de cualquier página. Las noticias de Cúcuta, la frontera y el país se publican a diario en la sección Noticias.',150,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `preguntas_frecuentes` VALUES (16,'TV Frontera','¿Cómo pauto o anuncio mi negocio en TV Frontera?','Escríbenos desde la página de contacto o por WhatsApp contándonos qué quieres promocionar. Te enviamos las opciones de pauta en televisión, radio y medios digitales.',160,1,'2026-11-19 05:08:55');
INSERT  IGNORE INTO `anuncios` VALUES (1,'Participa y gana: regístrate en nuestro Televentas Fest','/registro',1,0,NULL,NULL,'2026-11-14 17:26:31','2026-11-16 23:32:35');
INSERT  IGNORE INTO `anuncios` VALUES (2,'Nueva programación disponible todos los días a las 6 p. m.',NULL,1,1,NULL,NULL,'2026-11-14 17:26:31','2026-11-16 23:32:50');
INSERT  IGNORE INTO `anuncios` VALUES (3,'Visita nuestros Puntos Aliados y obtén beneficios exclusivos','/puntos-aliados',1,2,NULL,NULL,'2026-11-14 17:26:31','2026-11-16 23:32:41');
INSERT  IGNORE INTO `retos_semana` VALUES (1,1,'Bono de $10.000 en Puntos Aliados',NULL,3,5);
INSERT  IGNORE INTO `retos_semana` VALUES (2,1,'Recarga de celular $10.000',NULL,3,5);
INSERT  IGNORE INTO `retos_semana` VALUES (3,1,'Combo de comida de un Punto Aliado',NULL,3,5);
INSERT  IGNORE INTO `retos_semana` VALUES (4,1,'Bono de $15.000 en Puntos Aliados',NULL,4,5);
INSERT  IGNORE INTO `retos_semana` VALUES (5,1,'Entradas dobles a evento de TV Frontera',NULL,4,3);
INSERT  IGNORE INTO `retos_semana` VALUES (6,1,'Kit Televentas Fest',NULL,5,5);
INSERT  IGNORE INTO `retos_semana` VALUES (7,1,'Doble oportunidad en el sorteo anual',NULL,2,10);
INSERT  IGNORE INTO `premios_metas` VALUES (1,'Kit Televentas Fest','Gorra y botilito oficial de Televentas Fest',NULL,5,NULL,1,'2026-11-17 02:23:43');
INSERT  IGNORE INTO `premios_metas` VALUES (2,'Bono de compra $50.000','Bono para usar con cualquier Punto Aliado',NULL,15,50,1,'2026-11-17 02:23:43');
INSERT  IGNORE INTO `premios_metas` VALUES (3,'Gran premio: televisor','Para los primeros en llegar a 50 referidos',NULL,50,3,1,'2026-11-17 02:23:43');

SET FOREIGN_KEY_CHECKS = 1;
