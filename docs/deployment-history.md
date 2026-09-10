# Historial de instalaciones anteriores

> Documento archivado antes de la migración completa a Railway. Sus referencias
> a Vercel, tareas de Windows y al cron externo no describen el servicio actual.
> Consultar el [README vigente](../README.md).

App independiente para crear widgets de Instagram ingresando un `@usuario` público.
No utiliza OAuth, claves de Meta ni las variables o la base de datos de
`nexoworks-instagram-widgets`. Esa app se mantiene separada.

## Estado de la extracción

La instalación publicada usa **Apify como proveedor en la nube**. Vercel mantiene
el panel y los widgets, solicita las extracciones y guarda las imágenes en Blob.
Railway revisa los perfiles cada 15 minutos y actualiza los que cumplen seis horas
desde la última consulta. El servicio funciona con la PC apagada.
La tarea de Windows está **desactivada**, a pedido del usuario.

**Apify verificado el 7 de septiembre de 2026:** `@tina.horeca` actualizó 12
publicaciones a las 21:50 UTC y `@nexoworksen` actualizó 9 a las 21:52 UTC. Las 21
publicaciones tienen texto y miniatura. Los feeds y sus 23 imágenes (incluidos los
dos avatares conservados) respondieron correctamente desde producción, sin errores
de extracción ni de almacenamiento. El token está guardado como secreto de
Production en Vercel. El cron de Railway está activo con `*/15 * * * *`.

El scraper directo, conservado como alternativa, consulta el HTML público y, si las publicaciones se cargan con JavaScript,
abre el mismo perfil en Chromium con un contexto temporal sin sesión. Lee los datos
incluidos en la página y las respuestas que esa página carga normalmente.

**Prueba anterior del extractor directo, el 7 de septiembre de 2026:** 9 publicaciones de
`@nexoworksen` y 12 de `@tina.horeca`, sin iniciar sesión, con miniaturas guardadas
localmente y enlaces a los posts. En esa consulta no se obtuvieron los textos de
las publicaciones. La cantidad disponible depende de lo que cargue la página.

La versión inicial mostraba incorrectamente `Sin publicaciones` por dos errores:
no reconocía enlaces como `/usuario/p/código/` e ignoraba las respuestas GraphQL
servidas como `text/javascript`. Ambos formatos ahora están contemplados. Un error
de extracción muestra `No se pudo leer el feed`; `Sin publicaciones` se reserva
para un perfil cuyo contador público indica cero y que no devuelve posts.

Con Apify, la disponibilidad depende del proveedor y del acceso que obtenga a los
perfiles públicos. El extractor directo depende de que Instagram entregue los datos
sin iniciar sesión. Los tests automatizados usan fixtures sintéticos separados de
los datos reales guardados por la aplicación.

El extractor directo no inicia sesión, importa cookies, resuelve desafíos ni rota
proxies. La app no intenta leer cuentas privadas ni genera publicaciones ficticias.
Las fallas del proveedor se muestran en el panel y conservan la última copia válida
durante un máximo de 24 horas.

## Iniciar en Windows

Requiere Node.js 22.15 o posterior.

```powershell
cd ..\nexoworks-instagram-public
npm install
npm run install:browser
Copy-Item .env.example .env
npm run dev
```

Abrir **http://127.0.0.1:3107**. Si ya existe `.env`, conservarlo en lugar de copiar
el ejemplo. En esta máquina se dejó configurado el ejecutable de Chrome instalado,
porque la descarga de Chromium agotó el tiempo de espera. Se usa únicamente su
ejecutable; el scraper crea un contexto sin el perfil ni la sesión del usuario.

Para usar un ejecutable compatible ya instalado:

```dotenv
CHROMIUM_EXECUTABLE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
```

## Uso

1. Ingresar un usuario o URL de perfil público, nombre del cliente y diseño.
2. Crear el widget y esperar el resultado de la consulta.
3. Cuando haya un feed, revisar la galería y copiar el iframe.
4. Pegar el código en la web del cliente. En producción debe apuntar al dominio
   público de esta app, no a `localhost`.

El panel permite actualizar, cambiar título/diseño/cantidad y eliminar widgets.
Incluye los seis diseños de la app original: carrusel, grilla, collage, carrusel
con texto, una publicación y hashtags. Los assets del widget se copiaron a este
proyecto y son independientes a partir de ahora.

## Datos y actualización

- Extrae nombre, biografía, foto, contadores disponibles y hasta 24 publicaciones
  visibles, con miniatura, enlace, tipo, texto y fecha cuando están presentes.
- Un valor que Instagram no entrega permanece vacío o `null`. No se prometen
  todos los posts, el orden cronológico, videos descargables, stories ni métricas
  privadas. Los posts fijados pueden alterar el orden de la página.
- Guarda configuración y último feed en `data/widgets.json`, con escritura atómica.
- Copia las miniaturas a `data/media/`. Si una imagen no puede guardarse, usa su
  URL pública de Instagram y avisa que ese enlace puede vencer.
- En local y en el modo Apify, las visitas al iframe solo leen lo guardado.
  Crear un widget o pulsar Actualizar solicita la extracción desde el servidor.
- La instalación local tiene un intervalo predeterminado de 60 minutos; la
  instalación publicada y su worker usan 360 minutos. La cola ejecuta un perfil por vez y las
  actualizaciones manuales del mismo perfil tienen un mínimo de un minuto.
- Un 429 de Instagram pausa la cola 15 minutos. Las fallas conservan el último
  feed por un máximo de 24 horas; detectar un perfil privado o eliminado lo retira.
- Una instalación admite hasta 100 widgets, uno por usuario. El almacenamiento
  JSON local está pensado para **una sola réplica/proceso** y un volumen persistente.
  Vercel usa Blob privado, escrituras condicionales con ETag y un bloqueo compartido
  con vencimiento para evitar actualizaciones simultáneas.

## Variables

| Variable | Valor predeterminado / uso |
| --- | --- |
| `PORT` | `3107` |
| `HOST` | Sin clave se fuerza `127.0.0.1`; con clave se puede publicar en `0.0.0.0` |
| `ADMIN_TOKEN` | Clave de acceso al panel, mínimo 32 caracteres; obligatoria en producción |
| `DATA_DIR` | Carpeta `data` de esta app |
| `CACHE_TTL_MINUTES` | `60`, entre 15 y 1440 minutos |
| `SCRAPE_TIMEOUT_MS` | `45000`, entre 10000 y 120000 ms por consulta de perfil |
| `CHROMIUM_EXECUTABLE_PATH` | Opcional; por defecto usa el Chromium de Playwright |
| `REFRESH_EXECUTOR` | `external` en Vercel guarda pedidos para el worker y evita extraer desde el hosting |
| `SCRAPE_PROVIDER` | `apify` en producción; `direct` conserva el scraper de Chromium |
| `APIFY_TOKEN` | Token secreto de la cuenta de Apify, solo en el servidor |
| `APIFY_MAX_CHARGE_USD` | `0.10`: límite enviado a Apify por ejecución; configurable hasta 1 USD |

Sin clave solo permite desarrollo local. Con clave, el panel inicia una sesión en
cookie firmada y HTTP-only por 12 horas. Las escrituras requieren autenticación y
protección de origen. Los iframes y feeds son públicos por diseño.

## Docker / Railway

El Dockerfile instala Chromium y sus dependencias. Crear un servicio nuevo con
esta carpeta, una sola réplica y un volumen montado en `/data`. Configurar
`ADMIN_TOKEN` con una clave aleatoria, `HOST=0.0.0.0` y HTTPS en el proxy de entrada.
La app respeta `PORT` y expone `/health`. No requiere una base de datos externa.
La cola automática local requiere un proceso siempre encendido.

### Prueba desde Railway

El 7 de septiembre de 2026 se construyó este Dockerfile en Railway y se ejecutó
una consulta única de `@tina.horeca` en el servicio
[instagram-scraper](https://railway.com/project/c88590a5-162a-4eb4-a15c-48b3f9803504/service/507629ac-c10a-4fb7-b96a-fa594d29293b).
El proceso arrancó correctamente, pero Instagram respondió **HTTP 429** a la
consulta inicial. El resultado fue `RATE_LIMITED`; no se obtuvieron publicaciones.
Esto confirma que el contenedor puede ejecutarse allí, pero no que Railway resuelva
las restricciones de Instagram.

La prueba usa el comando siguiente, consulta un único perfil, informa el resultado
y termina sin modificar los widgets ni el almacenamiento de Vercel:

```powershell
npm run probe -- tina.horeca
```

Esa prueba usó `node scripts/probe-instagram.mjs tina.horeca`, política de reinicio
`NEVER` y ningún cron activo. Un resultado fallido sale con código 1 y Railway puede
mostrarlo como `Crashed`, aunque la tarea ya haya terminado.

El servicio ahora usa `Dockerfile.cron` y ejecuta
`scripts/trigger-cloud-refresh.mjs`. Ese contenedor consulta el endpoint protegido
de Vercel; Apify se encarga de la extracción. No instala Chromium. El horario
activo es `*/15 * * * *`: revisa feeds vencidos cada 15 minutos y Vercel solo renueva
los que superan el intervalo de seis horas. El contenedor termina después de cada
consulta y usa política de reinicio `NEVER`.

## Conectar Apify

Esta instalación ya está conectada y probada. Para otra instalación:

1. Obtener un token en [Apify → Settings → API & Integrations](https://console.apify.com/settings/integrations).
2. Agregar `APIFY_TOKEN` como variable **secreta**, entorno **Production**, del
   proyecto `nexoworks-instagram-public` en Vercel. No pegarlo en el repositorio.
3. Volver a desplegar. La presencia del token quita el aviso de configuración;
   la validez del token se verifica recién al realizar una consulta.
4. Probar Actualizar con un perfil y 12 publicaciones. Verificar las imágenes y
   el resultado de la ejecución en Apify antes de habilitar el cron de Railway.

El proveedor usa el Actor mantenido por Apify
[`apify/instagram-post-scraper`](https://apify.com/apify/instagram-post-scraper),
con paquete `basicData`, un perfil por ejecución y el límite de posts del widget
(entre 1 y 24). Solicita un máximo de 0,10 USD por ejecución. Ese parámetro no es
un límite mensual de la cuenta. Se pueden configurar límites de uso adicionales
en Apify.

La API se autentica mediante header, sin exponer el token en URLs ni en el navegador.
El código inicia una ejecución una sola vez, espera su resultado y descarga el
dataset. Si se interrumpe la espera intenta abortar la ejecución; también configura
un timeout en Apify. Un inicio con resultado de red ambiguo no se reintenta
automáticamente para evitar duplicar ejecuciones pagas.

Los resultados se validan por dueño del post, shortcode y dominio de imágenes.
Un dataset vacío o inválido muestra error y conserva la última copia disponible.
Este Actor de posts no entrega un perfil completo: se mantienen los datos previos
del perfil cuando faltan y los contadores nuevos desconocidos permanecen en `null`.
Los IDs privados de ejecución y las credenciales no se incluyen en el feed público.

Railway solo necesita `CRON_SECRET` y, opcionalmente, `APP_URL`. La clave de Apify y
el token de Blob permanecen en Vercel. El endpoint programado procesa hasta dos
perfiles por ejecución; deja los restantes para la próxima revisión. El script
termina al finalizar y su política de reinicio es `NEVER`.

## Extraer imágenes y exportar datos

El extractor independiente genera una carpeta por ejecución con `run.json`,
`dataset.json`, `dataset.csv` y las imágenes descargadas en `media/`.
No requiere una cuenta ni un token de Apify.

```powershell
cd ..\nexoworks-instagram-public
npm.cmd run extract -- nexoworksen --limit 12
```

En PowerShell se usa `npm.cmd` para conservar los argumentos `--limit` y `--output`.
La salida indica la carpeta creada dentro de `artifacts/extractions/`. `imageFile`
es una ruta relativa a esa carpeta; `displayUrl` solo se conserva cuando una imagen
no pudo descargarse. El CSV neutraliza fórmulas en textos del perfil al abrirlo en
una planilla. Un acceso restringido produce `run.json` con `FAILED`, sin un dataset
vacío que simule éxito.

La extracción real guardó nueve imágenes de `@nexoworksen`. Esta implementación
exporta las miniaturas disponibles de los posts, sin garantizar resolución
original, todas las imágenes internas de carruseles ni los campos que Instagram
no devuelve. No replica toda la plataforma ni la infraestructura de Apify.

## Worker de la PC (alternativa desactivada)

Esta alternativa quedó desactivada al elegir el servicio en la nube. Los comandos
siguientes se conservan como referencia; no es necesario ejecutarlos para Apify.

`scripts/refresh-cloud.mjs` consulta los widgets de Blob, procesa pedidos manuales
antes que feeds vencidos y actualiza sus datos e imágenes. Usa el bloqueo compartido
y escrituras condicionales para no sobrescribir ediciones concurrentes del panel.
Cada ejecución procesa hasta cuatro perfiles y termina; el siguiente ciclo continúa
con los pendientes. Un 429 pausa las consultas durante 15 minutos.

Esta máquina tiene `.env.worker` con `BLOB_READ_WRITE_TOKEN`,
`CHROMIUM_EXECUTABLE_PATH` y `CACHE_TTL_MINUTES=360`. Es privado y está excluido de
Git, Vercel y Docker. No necesita la clave del panel ni credenciales de Instagram.

Para ejecutar ahora los pedidos pendientes:

```powershell
node --env-file=.env.worker scripts/refresh-cloud.mjs
```

Para actualizar un widget concreto:

```powershell
node --env-file=.env.worker scripts/refresh-cloud.mjs --username tina.horeca
```

La tarea de Windows se llama `NexoWorks Instagram Public - Actualizar widgets`.
Corre sin ventana, cada 15 minutos, con el usuario actual y sin privilegios elevados.
No consulta Instagram si no hay pedidos ni feeds vencidos. No funciona con la PC
apagada o la sesión cerrada; si estaba suspendida, procesa la ejecución pendiente
al estar disponible. Los registros están en `artifacts/worker-logs/AAAA-MM-DD.log`.

**Verificación del flujo completo:** un pedido enviado al panel de producción fue
tomado por la tarea de Windows y actualizó las nueve publicaciones de `@nexoworksen`
el 7 de septiembre de 2026 a las 21:26 UTC. Terminó con código 0, retiró el pedido
de la cola y guardó las imágenes sin fallas. Los feeds de ambos widgets respondieron
200 y sus 23 imágenes (21 miniaturas y dos avatares) se descargaron correctamente.
También pasaron los 34 tests automatizados y la comprobación de sintaxis del build.

Para reinstalar la tarea después de mover la carpeta, primero quitar la tarea
anterior y ejecutar `scripts/install-worker-task.ps1` desde la nueva ubicación.
Para desactivarla:

```powershell
Disable-ScheduledTask -TaskName 'NexoWorks Instagram Public - Actualizar widgets'
```

## Vercel

**Sitio publicado:** https://nexoworks-instagram-public.vercel.app

Se migraron los dos widgets existentes y sus 23 imágenes al almacenamiento privado.
La clave del panel de esta instalación está en `.vercel/admin-access.txt`, excluido
de Git y del despliegue.

**Prueba en producción del 7 de septiembre de 2026:** el sitio, el acceso al panel,
los feeds y las imágenes funcionan. Al intentar actualizar desde Vercel, Instagram
redirigió el navegador anónimo al inicio de sesión para `@tina.horeca` y devolvió
un límite de consultas (429) para `@nexoworksen`. Por lo tanto, el scraping
desde ese servidor no está operativo, aunque los mismos perfiles se pudieron leer
desde esta computadora. Los widgets conservan la última copia durante 24 horas
desde la extracción exitosa; después dejan de mostrarla si no se pudo renovar.
La programación de actualizaciones desde ese hosting no resuelve la restricción.
La extracción desde esta PC sí actualizó las 12 publicaciones de `@tina.horeca`
en Blob durante la prueba anterior. Ese mecanismo fue desactivado.

El proyecto incluye `api/index.mjs` y `vercel.json`. Usa Node.js 22, Chromium para
funciones Linux (`@sparticuz/chromium`), Vercel Blob privado y `waitUntil` para
mantener activa la función mientras termina la actualización solicitada.

Los archivos de configuración y las imágenes están fuera del disco efímero. La
carpeta `static-build/assets` contiene solo los assets públicos; el HTML del panel
se sirve desde la función para aplicar la autenticación.

Variables de producción:

- `ADMIN_TOKEN`: clave aleatoria del panel.
- `CRON_SECRET`: clave independiente que autentica las ejecuciones programadas.
- `BLOB_READ_WRITE_TOKEN`: agregado al conectar el Blob privado al proyecto.
- `SCRAPE_TIMEOUT_MS=90000`: presupuesto de la consulta a Instagram.
- `REFRESH_EXECUTOR=server`: el servidor realiza las actualizaciones solicitadas.
- `SCRAPE_PROVIDER=apify`: selecciona Apify sin probar el scraper directo como fallback.
- `APIFY_TOKEN`: configurado como secreto de Production.
- `APIFY_MAX_CHARGE_USD=0.10`: límite por ejecución enviado a Apify.
- `CACHE_TTL_MINUTES=360`: intervalo de actualización de los feeds.

La función tiene un máximo de 300 segundos. El cron diario incluido en
`vercel.json` y el programador de Railway usan el mismo endpoint autenticado.
Si falta el token de Apify, responde con un error de configuración sin iniciar
extracciones. Las visitas a los iframes no disparan consultas pagas.

Para desplegar cambios desde esta carpeta vinculada:

```powershell
npm test
npx vercel deploy --prod --yes
```

Para migrar una instalación local a un Blob **vacío**, usando un archivo de
variables descargado de Vercel:

```powershell
node --env-file=.env.vercel.production scripts/migrate-to-blob.mjs
```

La migración conserva los IDs de los widgets y las imágenes, y rechaza sobrescribir
un estado remoto existente. Las claves locales, `.vercel/`, `data/` y los artefactos
están excluidos de Git y del despliegue.

## API y comprobaciones

- `GET /api/admin/widgets`: lista y estado.
- `POST /api/admin/widgets`: crear (`username`, `label`, `title`, `template`, `limit`).
- `PATCH /api/admin/widgets/:id`: cambiar presentación.
- `POST /api/admin/widgets/:id/refresh`: solicitar actualización.
- `DELETE /api/admin/widgets/:id`: eliminar y desactivar el iframe.
- `GET /api/public/widgets/:id/feed`: último feed disponible.
- `GET /embed/:id`: widget embebible.

Las escrituras requieren `X-Nexo-Request: 1` y `Content-Type: application/json`.
Los clientes de servidor pueden usar `Authorization: Bearer <ADMIN_TOKEN>`.

```powershell
npm test
npm run build
npm run scrape -- @usuario
```

`build` comprueba sintaxis; no hay compilación ni frontend dependiente de Next.js.
Los tests cubren parsing, URLs, cuentas privadas, persistencia, duplicados,
caducidad de caché, autenticación, protección de origen, API e imágenes. No hacen
consultas reales a Instagram. `scrape` sí realiza una consulta real y devuelve JSON
o un código de error.

Implementación del navegador basada en la [biblioteca oficial de Playwright](https://playwright.dev/docs/library).
