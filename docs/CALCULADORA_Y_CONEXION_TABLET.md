# Calculadora y conexión desde la tablet

Revisión del 11 de octubre de 2026.

## Cambios listos en la vista local

- Árboles: se admiten varios hijos en un nodo, incluyendo las dos expresiones
  enviadas en las capturas. Se dibujan todas las ramas y se puede recuperar la
  expresión desde el grupo seleccionado. Se mantienen los árboles anteriores.
- Calculadora: se quitó el recuadro redundante «MENU / Seleccioná un modo».
  Se conserva el botón para volver al menú y sus cinco modos.
- En Cálculo, **INV** alterna sin/cos/tan con sen⁻¹/cos⁻¹/tan⁻¹. Respeta DEG/RAD.
  También se pueden escribir `asin`, `acos`, `atan`, `arcsen`, `arcsin`,
  `arccos`, `arctan`, `arcseno`, `arccoseno` y `arctangente`, incluso «arc sen».
  Arco seno y arco coseno validan que su argumento esté entre -1 y 1.
- Sin nuevas dependencias ni migraciones. Vista: http://127.0.0.1:5178.

## Diagnóstico de Vercel

Comprobaciones reales realizadas:

- La página https://pizarraproyecto.vercel.app responde 200.
- `/api/auth/me` en Vercel devuelve 502.
- El destino anterior de `vercel.json`,
  `government-focuses-rehab-violations.trycloudflare.com`, no resuelve por DNS.
- El registro del túnel anterior informa «Unauthorized: Tunnel not found».
- El backend de la PC, `http://127.0.0.1:8765/healthz`, responde 200 y `ok:true`.

Se preparó una conexión nueva al mismo backend:
https://hopes-bird-casino-joy.trycloudflare.com. Se comprobó `/healthz` con
HTTP 200 y `ok:true`. `vercel.json` y `hosting.local.json` apuntan a ese destino
en el checkout local. Vercel todavía usa la configuración publicada anterior.

El script existente `scripts/conectar-vercel.mjs` ahora comprueba la salud del
destino antes de escribir archivos; un servidor inválido se rechaza conservando
la configuración previa. Se verificó tanto el caso válido como el rechazado.

La información del proceso nuevo está en `logs/conexion-pendiente.json`
(ignorado por Git). El túnel y el servidor actuales todavía no se reemplazaron
en `logs/conexion-actual.json`.

## Publicación pendiente de aprobación

El pedido original indica: «No despliegues modificaciones automáticamente al
servidor público ni borres datos reales sin mi aprobación».

Después de aprobar, se debe:

1. Comprobar nuevamente el túnel nuevo y conservar un punto de retorno de la
   versión pública. No borrar bases de datos ni datos del usuario.
2. Publicar los cambios revisados y `vercel.json` en la rama que Vercel despliega.
3. Reiniciar únicamente el backend público con la misma carpeta de datos,
   `PIZARRA_PUBLIC_ORIGINS=https://pizarraproyecto.vercel.app` y
   `PIZARRA_WS_ORIGIN=https://hopes-bird-casino-joy.trycloudflare.com`.
   El origen WebSocket del proceso público actual todavía es el túnel anterior.
4. Actualizar el registro de conexión, retirar el proceso del túnel caducado y
   comprobar login y una sesión compartida/WebSocket a través de Vercel.

Los Quick Tunnels son temporales, cambian de nombre al recrearlos y no garantizan
disponibilidad. Una conexión permanente requiere configurar un túnel con nombre
y un dominio estable; no se configuró una cuenta ni un dominio nuevos.
[Documentación oficial de Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Las pizarras privadas pertenecen al navegador y al origen donde se crearon.
Abrir la vista local o el túnel directo no transfiere las privadas de Vercel;
se puede usar el respaldo existente para trasladarlas.
