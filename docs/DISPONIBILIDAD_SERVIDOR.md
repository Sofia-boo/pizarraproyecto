# Disponibilidad de las pizarras compartidas

La página y la API se alojan en Vercel. Las cuentas, sesiones, carpetas, pizarras, permisos, imágenes e historial se guardan en PostgreSQL de **Neon Free**. La PC puede apagarse: no sirve solicitudes de producción ni guarda la única copia de las compartidas.

El error 502 del alojamiento anterior aparecía cuando Vercel reenviaba `/api/` a un túnel de Cloudflare cuyo servidor era esta PC. Al apagarla, suspenderla o caducar el túnel, la página seguía abriendo pero la API dejaba de responder. Se retiró ese reenvío de `vercel.json`.

## Sincronización

Los WebSockets se ejecutan en la función FastAPI con Fluid Compute. Las instancias comparten notificaciones mediante PostgreSQL LISTEN/NOTIFY, un registro breve de eventos y estado compartido de presencia, HTML, videos y confirmaciones de tinta. Los guardados comparan la versión dentro del UPDATE: una escritura concurrente recibe 409 y el cliente combina los cambios.

Vercel cierra las conexiones al llegar a su duración máxima (300 segundos en esta configuración). El cliente vuelve a conectarse y recupera la versión persistida y las confirmaciones de borrado. Al cerrar el último socket se cierra el listener para que la base pueda suspender su cómputo durante períodos sin uso.

## Datos y respaldo

`scripts/migrar_neon.py --apply` copia una instantánea consistente de SQLite a un destino PostgreSQL vacío, dentro de una transacción. Rechaza sobrescribir tablas existentes y verifica todos los valores de cada tabla, incluidos archivos y hashes de contraseñas. No imprime datos personales ni claves. Conserva la base original y genera `datos/backups/antes-neon-*.db`.

Las privadas y las copias sin conexión siguen en IndexedDB de cada dispositivo. No se trasladan a Neon. Los respaldos previos a eliminar usuarios también se conservan en PostgreSQL; las credenciales se configuran únicamente como variables privadas en Vercel.

## Límites gratuitos

- Neon está en Free; Vercel permanece en Hobby. No se activó un plan pago. Si se alcanzan las cuotas, el servicio puede limitarse o pausarse.
- Neon Free publica 1 GB y 100 horas de cómputo por proyecto al mes; revisar el panel para el consumo real y los límites vigentes.
- Cada imagen puede tener hasta 30 MB. Los archivos grandes viajan en partes de hasta 1 MB y se publican al completar la transferencia. Las páginas de PDF siguen convirtiéndose en imágenes como antes.
- El contenido JSON de una pizarra sigue sujeto al límite de solicitud/respuesta de Vercel (4,5 MB). Los cambios que no se pueden enviar quedan pendientes en la copia local; las privadas no tienen ese límite de red.
- La primera solicitud tras un período sin uso puede tardar más mientras arranca el servicio. Estar en la nube no garantiza disponibilidad absoluta.
- Los programas que requieren software en la PC (Chrome automatizado o un Judge0 local) no se trasladan a Vercel. El uso local de ChatGPT en Android y el flujo de copiar/pegar siguen siendo independientes.

Documentación: [FastAPI en Vercel](https://vercel.com/docs/frameworks/backend/fastapi), [WebSockets](https://vercel.com/docs/functions/websockets), [límites de funciones](https://vercel.com/docs/functions/limitations), [Neon Free](https://neon.com/pricing).
