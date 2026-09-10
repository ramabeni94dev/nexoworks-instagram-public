# NexoWorks Instagram Public

App independiente para crear widgets de Instagram ingresando un `@usuario` público.
Usa Apify para obtener publicaciones e imágenes. No utiliza OAuth de Meta ni los
datos de la app original `nexoworks-instagram-widgets`.

## Instalación actual: Railway + Apify

**Panel:** https://instagram-scraper-production.up.railway.app

**Widget de Tina:** https://instagram-scraper-production.up.railway.app/embed/df8e0545-1f8c-461a-a3f3-3f697eb14028

El panel, los iframes, la actualización automática y los archivos funcionan en un
único servicio de Railway. Las configuraciones están en `/data/widgets.json` y las
imágenes en `/data/media/`, dentro de un volumen persistente. Railway solicita las
ejecuciones de Apify y descarga sus resultados al volumen.

No requiere Vercel, Vercel Blob, una base de datos separada ni la PC encendida.
La tarea de Windows quedó desactivada. El anterior servicio cron de Railway se
convirtió en el servidor web; ya no tiene una programación cron independiente.

Se conservaron los IDs y la configuración de los dos widgets:

| Perfil | Publicaciones | Actualización automática |
| --- | ---: | --- |
| `@tina.horeca` | 12 | Cada seis horas |
| `@nexoworksen` | 9 | Desactivada; actualización manual disponible |

El proceso comprueba los vencimientos cada minuto y al arrancar. Solo consulta
Apify cuando corresponde actualizar. Las visitas al iframe leen la copia guardada
y no disparan extracciones. Si falla una consulta, conserva el último feed durante
un máximo de 24 horas; un perfil privado o eliminado se retira. Un widget con
actualización automática desactivada también vence a las 24 horas.

## Verificación de la migración

El 7 de septiembre de 2026 se copiaron dos widgets y 23 imágenes desde Vercel.
Las imágenes descargadas desde Railway coincidieron con los hashes de origen.
Se verificaron el panel, la cookie segura y el rechazo de acceso administrativo
sin autenticación.

Una extracción real de Tina desde Railway finalizó a las **23:33 UTC** con 12
publicaciones, textos e imágenes, sin errores. Se reinició el servicio y se
comprobó que la actualización y sus 13 imágenes, incluido el avatar, permanecían
disponibles. El widget también se verificó en Brave.

Pasaron **42 tests** y la comprobación de sintaxis del build. Se añadió cobertura
para perfiles pausados y para conservar el avatar anterior cuando Apify solo
entrega datos de publicaciones.

La copia de migración está en `artifacts/railway-migration-20260907/`, excluida de
Git y del despliegue. Incluye el estado original, los archivos importados y un
manifiesto SHA-256. Es una copia de recuperación; el servicio no la necesita para
funcionar. Las copias automáticas de volúmenes no se habilitaron: Railway las limita
al plan Pro en esta cuenta, y no se contrató ese plan.

## Insertar el widget de Tina

Reemplazar el iframe anterior de Vercel por este código. Los IDs se conservaron,
pero el dominio del alojamiento cambió.

```html
<iframe
  src="https://instagram-scraper-production.up.railway.app/embed/df8e0545-1f8c-461a-a3f3-3f697eb14028"
  title="Instagram de Tina"
  width="100%"
  height="640"
  style="border:0"
  loading="lazy"
  referrerpolicy="no-referrer"
></iframe>
```

También está en [docs/tina-iframe.html](docs/tina-iframe.html). La clave del panel
se conserva; su copia local está en `.vercel/admin-access.txt`, privada y excluida
de Git y del despliegue.

## Dos diseños nuevos para Tina

Se agregaron al selector de creación y edición:

- **Cuadrícula sin espacios** (`photo-wall`): fotos verticales en proporción 4:5
  (1080 × 1350) sin separación, cinco
  columnas en escritorio, tres en tablet y dos en celular. Muestra como máximo dos
  filas: hasta diez fotos en escritorio, seis en tablet y cuatro en celular, según
  las publicaciones disponibles y el límite elegido. Indica reels y carruseles
  sobre la imagen. Encima de la grilla muestra avatar, nombre, usuario y biografía
  del perfil.
- **Tarjetas con compartir** (`social-cards`): cuatro tarjetas en escritorio, dos
  en tablet y una en celular. Fecha, enlace a Instagram, foto cuadrada, texto de
  hasta cinco líneas y acción para compartir; flechas y desplazamiento táctil.

Al tocar una foto se abre su detalle. Compartir usa la función del dispositivo o
copia el enlace; si el navegador bloquea ambas, ofrece abrir la publicación.
El título es editable. Un título con `#` es presentación del feed del usuario,
no una búsqueda adicional por hashtag.

Códigos listos para insertar:

- [Cuadrícula de Tina](docs/tina-cuadricula.html).
- [Tarjetas de Tina](docs/tina-tarjetas.html).

Los nuevos códigos fijan `template`, `limit` y `title` en la URL. Así pueden convivir
los dos diseños del mismo perfil, compartiendo las imágenes y la actualización de
Apify. No crean otro widget ni disparan extracciones. Los iframes anteriores sin
parámetros siguen usando la configuración guardada del panel.

Copiar también el `<script>` de altura automática, que valida el origen y la ventana
del iframe antes de ajustar su tamaño. Si el editor del sitio elimina scripts,
ajustar manualmente el atributo `height`. El permiso `allow` habilita compartir y
copiar dentro del iframe cuando el navegador y el sitio lo permiten.

`/embed/:id` y su `config.js` aceptan solo diseños conocidos. El límite de la URL no
puede superar el configurado para ese perfil; el contenido disponible también
depende de cuántas publicaciones se hayan obtenido. Los títulos se limitan a 160
caracteres y se escapan. La suite incluye **45 pruebas**, con cobertura de los dos
diseños, lectura sin extracción, parámetros inválidos y mensajes de altura falsos.

## Configuración de Railway

- Proyecto: `nexoworks-instagram-public` (`c88590a5-162a-4eb4-a15c-48b3f9803504`).
- Servicio: `instagram-scraper` (`507629ac-c10a-4fb7-b96a-fa594d29293b`).
- Entorno: `production` (`e6a84101-a253-4083-a486-2780c37f4652`).
- Volumen: `instagram-scraper-volume`, montado en `/data`.
- Construcción: `Dockerfile`; arranque: `node server.mjs`.
- Una sola réplica, sin suspensión automática, healthcheck `/health`.
- Reinicio `ON_FAILURE`, hasta diez intentos.

El Dockerfile no instala ni ejecuta Chromium. El proveedor directo se carga solo
al seleccionarlo explícitamente; la instalación publicada usa Apify.

| Variable | Valor / uso |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3107`, también usado por el dominio de Railway |
| `DATA_DIR` | `/data` |
| `ADMIN_TOKEN` | Secreto del panel, al menos 32 caracteres |
| `SCRAPE_PROVIDER` | `apify` |
| `APIFY_TOKEN` | Secreto de Apify en Railway |
| `APIFY_MAX_CHARGE_USD` | `0.10` por ejecución; no es un límite mensual |
| `REFRESH_EXECUTOR` | `server` |
| `CACHE_TTL_MINUTES` | `360` |
| `SCRAPE_TIMEOUT_MS` | `90000` |
| `CRON_SECRET` | Endpoint de mantenimiento; el programador interno no lo necesita |

Para desplegar desde esta carpeta ya vinculada:

```powershell
npm.cmd test
npm.cmd run build
railway up --service 507629ac-c10a-4fb7-b96a-fa594d29293b --environment e6a84101-a253-4083-a486-2780c37f4652 --project c88590a5-162a-4eb4-a15c-48b3f9803504 --detach
```

No sobrescribir `/data/widgets.json` con la copia inicial: se perderían cambios
posteriores. Los archivos se pueden descargar con `railway service files download`
para generar una copia adicional.

## Apify y costos

Se usa el Actor [apify/instagram-post-scraper](https://apify.com/apify/instagram-post-scraper)
con `basicData`, un perfil por ejecución y hasta 24 publicaciones según el widget.
Se validan el dueño de cada post y sus imágenes. Un resultado vacío o inválido
muestra un error, sin inventar publicaciones. Los datos del perfil que el Actor no
entrega se conservan de la copia anterior; los contadores desconocidos quedan en
`null`.

Para Tina con 12 posts y cuatro consultas diarias, 30 días suman 1.440 resultados:
aproximadamente **US$2,45 de consumo de Apify**, cubiertos por los US$5 mensuales del
plan gratuito si no se consumen en otros trabajos. Las actualizaciones manuales
adicionales aumentan el consumo.
[Tarifa del Actor](https://apify.com/apify/instagram-post-scraper/pricing) ·
[Planes de Apify](https://apify.com/pricing).

Railway usa el plan Hobby existente: su mínimo mensual de US$5 incluye consumo
compartido entre proyectos. La app agrega memoria, CPU, disco y transferencia;
el total depende del consumo conjunto y de las visitas. Esta migración evita
necesitar Vercel Pro para alojar el widget comercial. No se contrataron nuevos
planes. [Precios de Railway](https://railway.com/pricing).

## Retiro de Vercel

Railway ya funciona de forma independiente. Queda pendiente pausar el proyecto
anterior de Vercel: su CLI exige confirmación interactiva del usuario y devuelve
`interactive_confirmation_required` al intentarlo mediante automatización.
Una vez reemplazados los iframes, ejecutar en una terminal:

```powershell
npx vercel project pause nexoworks-instagram-public --scope ramabeni94devs-projects
```

Escribir `nexoworks-instagram-public` cuando lo solicite. Al pausar, las URLs del
dominio anterior dejan de servir contenido. La copia de migración permite recuperar
los datos sin depender del Blob anterior. No volver a desplegar esta app en Vercel.

## Desarrollo local

Requiere Node.js 22.15 o posterior. El desarrollo local es opcional.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Abrir http://127.0.0.1:3107. Si ya existe `.env`, conservarlo. Sin `ADMIN_TOKEN`
solo se permite acceso local. Para probar Apify, configurar su token y seleccionar
`SCRAPE_PROVIDER=apify`; esas consultas usan créditos de la cuenta.

El extractor directo, sus comandos de exportación y las pruebas anteriores de
Vercel y Windows se documentan en [el historial](docs/deployment-history.md).
Esas alternativas no forman parte del servicio actual.

## API

- `GET /api/admin/widgets`: lista y estado.
- `POST /api/admin/widgets`: crear (`username`, `label`, `title`, `template`, `limit`).
- `PATCH /api/admin/widgets/:id`: presentación y `autoRefresh` booleano.
- `POST /api/admin/widgets/:id/refresh`: actualización manual.
- `DELETE /api/admin/widgets/:id`: eliminar y desactivar el iframe.
- `GET /api/public/widgets/:id/feed`: último feed disponible.
- `GET /embed/:id`: widget embebible.

Las escrituras requieren `X-Nexo-Request: 1` y `Content-Type: application/json`.
Los clientes de servidor pueden usar `Authorization: Bearer <ADMIN_TOKEN>`.
El panel usa una cookie firmada, HTTP-only, segura sobre HTTPS, con protección
de origen. Los feeds y sus imágenes son públicos; se sirven únicamente las
imágenes referenciadas por un feed vigente.
