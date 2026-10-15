# Vercel + Neon Free

Producción: **https://pizarraproyecto.vercel.app**. La PC no necesita permanecer encendida.

- Vercel sirve el frontend compilado y la función FastAPI `web_host:app`, en São Paulo (`gru1`). Fluid Compute está habilitado.
- Neon Free guarda las cuentas, pizarras compartidas, carpetas, permisos, archivos e historial. No hay base de producción en el disco temporal de Vercel.
- Las privadas y copias descargadas siguen en cada dispositivo; se abren con «Abrir privadas y copias de este dispositivo».
- Sin conexión, las ediciones compartidas quedan pendientes localmente y se combinan al volver a conectar. Descargar respaldos sigue siendo recomendable.

## Publicar

Vercel publica la rama `main`. `vercel.json`, `pyproject.toml` y `.python-version` definen la compilación (`npm ci && npm run build`), Python 3.12, el backend y los archivos estáticos del CDN.

`DATABASE_URL` y `DATABASE_URL_UNPOOLED` las proporciona la integración Neon del proyecto. Nunca poner sus valores en Git, el frontend o comandos de consola. `PIZARRA_DATABASE_URL` y `PIZARRA_DATABASE_DIRECT_URL` permiten destinos explícitos para pruebas aisladas. `PIZARRA_PUBLIC_ORIGINS` admite la URL pública; en producción `PIZARRA_WS_ORIGIN` debe estar ausente o apuntar al mismo dominio de Vercel, nunca al túnel de la PC.

La migración inicial se ejecuta una sola vez con `scripts/migrar_neon.py`. Requiere un destino vacío y conserva SQLite. No ejecutar una segunda migración sobre datos nuevos de Neon. Los cambios de esquema futuros necesitan migraciones específicas.

## Verificar

```powershell
npm.cmd test
.venv\Scripts\python.exe -m unittest discover -s tests
npm.cmd run build
npm.cmd run test:browser
```

Las pruebas Python usan datos temporales. Para probar PostgreSQL y dos procesos reales, apuntar `PIZARRA_TEST_DATABASE_URL` a un PostgreSQL **local de pruebas** y ejecutar `tests.test_backend` y `tests.test_cloud` en comandos separados; crean y eliminan su propio esquema. No aceptan una URL de nube para prevenir pruebas sobre datos reales.

## Instalación local

`iniciar_pizarra.ps1` sigue sirviendo SQLite para uso local explícito. La base local es una copia anterior a la migración, no una réplica automática de Neon. No iniciar los scripts antiguos de túnel para usar la página pública. Reemplazar la configuración de nube con esos scripts requiere `--usar-servidor-local` o `-UsarServidorLocal` explícitamente.

Consultar [disponibilidad, respaldo y límites gratuitos](docs/DISPONIBILIDAD_SERVIDOR.md).
