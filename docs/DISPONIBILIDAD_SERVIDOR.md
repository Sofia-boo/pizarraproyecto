# Disponibilidad de las pizarras compartidas

La configuración actual tiene dos alojamientos: Vercel sirve la página y reenvía `/api/` al servidor Python de la PC mediante un Quick Tunnel de Cloudflare. SQLite y los archivos compartidos están en `datos/` de esa PC. Las privadas y las copias descargadas se guardan en cada dispositivo.

Apagar o suspender la PC, cerrar el servidor Python o perder el túnel deja inaccesibles el inicio de sesión y la colaboración. Vercel puede seguir mostrando la página y responder HTTP 502 a las solicitudes del servidor. Un túnel nuevo cambia su dirección y exige actualizar también `PIZARRA_WS_ORIGIN`, `hosting.local.json` y `vercel.json`.

El 15 de octubre de 2026 se comprobó que el puerto local 8765 rechazaba conexiones y que el hostname anterior no resolvía por DNS. Se inició un servidor con la misma carpeta de datos, se creó un túnel nuevo y se actualizó el destino público. Esta recuperación mantiene la dependencia de la PC.

## Funcionamiento con la PC apagada

Hace falta alojar el backend y los datos en un servidor independiente con HTTPS, WebSockets y almacenamiento persistente. Cambiar únicamente a un hostname fijo no mantiene encendida la PC que ejecuta Python.

El repositorio ya incluye un `Dockerfile` que compila la página y ejecuta el backend con un solo trabajador. La migración debe:

1. Preparar el alojamiento y un volumen persistente para `PIZARRA_DATA_DIR`, que por defecto es `/app/datos` en la imagen.
2. Crear una copia consistente de SQLite, con el servidor detenido o la API de respaldo de SQLite, y copiar los archivos de `datos/`. Conservar la copia local original.
3. Configurar `PIZARRA_PUBLIC_ORIGINS=https://pizarraproyecto.vercel.app` y `PIZARRA_WS_ORIGIN` con la URL HTTPS del nuevo servidor.
4. Probar salud, cuentas, archivos y colaboración con datos aislados; verificar también la conservación de los datos al reiniciar el servicio.
5. Cambiar el destino de Vercel mediante `scripts/conectar-vercel.mjs` y comprobarlo antes de retirar el túnel de la PC.

El proveedor, la cuenta y las condiciones del alojamiento siguen pendientes. No se creó ningún servicio de pago ni se trasladaron los datos a un tercero.

Cloudflare documenta que los [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) son temporales, están destinados a pruebas y no tienen garantía de disponibilidad.
