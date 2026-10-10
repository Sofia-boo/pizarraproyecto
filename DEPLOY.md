# Publicar la pizarra con guardado permanente

La aplicación necesita un proceso Python, WebSockets y un disco persistente.
El Dockerfile sirve la web y la API juntos para que las sesiones funcionen en
el mismo dominio. `render.yaml` configura un servicio Starter con disco de 1 GB;
ese servicio y su disco son pagos. No se crean recursos hasta activar el Blueprint.

## Render

1. Subí estos archivos al repositorio de GitHub.
2. En https://dashboard.render.com seleccioná **New > Blueprint** y conectá
   `Sofia-boo/pizarraproyecto`. Revisá el precio antes de crear el servicio.
3. Esperá a que termine el despliegue y abrí la URL HTTPS que Render asigne.
   `/healthz` debe devolver 200 y `/api/auth/me`, sin sesión, 401 (nunca 404).
4. En la consola del servicio ejecutá `python configurar_password_admin.py`
   para elegir la contraseña del usuario `Administrador`.
5. Probá crear un usuario, entrar, crear una pizarra y recargarla.

SQLite, imágenes, sesiones, respaldos y letras entrenadas quedan en `/app/datos`.
Mantené un solo proceso y una instancia: la presencia en vivo usa memoria local.
No cambies `PIZARRA_DATA_DIR` ni borres el disco al actualizar la aplicación.

## Conectar el enlace de Vercel

Con la URL real del servicio, ejecutá desde la raíz del proyecto:

```powershell
node scripts/conectar-vercel.mjs https://TU-SERVICIO.onrender.com
```

Subí el `vercel.json` generado a GitHub. Vercel redirigirá el enlace existente
al servicio completo. La dirección del navegador cambiará a Render y todos
los accesos, cookies y WebSockets usarán ese mismo dominio.

## Datos existentes

El primer despliegue crea una base nueva. Los usuarios, contraseñas y pizarras
locales no se suben a GitHub. Para conservarlos, detené las escrituras y transferí
una copia consistente de `datos/pizarras.db` al disco del servicio antes de usarlo.
Usá la API de backup de SQLite, no copies solo el `.db` mientras hay escrituras WAL.
Transferí también `datos/letter_samples.json` si existe; en caso contrario se
usan una sola vez las muestras iniciales de `reconocimiento_local/letter_samples.json`.
No compartas la base ni `CLAVE_ADMINISTRADOR.txt` en un repositorio público.

## Reconocimiento opcional

La imagen incluye reconocimiento con muestras entrenadas y autocorrección.
Los motores locales pesados TrOCR, EasyOCR y pix2tex requieren dependencias
adicionales y más memoria; no están incluidos en el servicio base.
Las claves opcionales `GEMINI_API_KEY`, `GROQ_API_KEY` y `HF_TOKEN` se configuran
en el panel del servidor, nunca en el frontend ni en GitHub.

## Uso local

`iniciar_pizarra.ps1` sigue compilando y ejecutando la aplicación con `.venv`.
Sin `PIZARRA_DATA_DIR` los datos siguen guardándose en `datos/` del proyecto.
