# Compartir y estudiar

En Perfil → Compartir pizarra actual aparece un código aleatorio de cuatro dígitos, válido durante 24 horas. El otro usuario inicia sesión y elige Perfil → Ingresar a la pizarra. Primero se guardan los cambios pendientes y después se abre la pizarra del código. Los enlaces de invitación anteriores siguen funcionando.

Un primer ingreso crea una pertenencia con permiso de edición y la ubica en la carpeta personal **Pizarra compartida**. Reingresar no crea duplicados ni modifica carpetas. El creador conserva la ubicación de su pizarra. Mover una compartida cambia únicamente la ubicación para esa cuenta; si se elige una carpeta privada, la ubicación queda guardada en ese dispositivo. Compartir una privada publica una copia y mantiene la carpeta local del creador.

El código requiere una sesión y tiene un límite de intentos. Solo el propietario puede generarlo. Al vencer, generar otro no borra la pizarra ni expulsa a sus participantes.

El seguimiento transmite centro, zoom y tamaño de pantalla para encuadrar la vista completa del otro usuario en la tablet. Moverse, dibujar o usar el teclado termina el seguimiento. Las pestañas de una misma cuenta conservan la cámara que cambió más recientemente; los latidos de otra pestaña no deben reemplazarla. Se evitan ciclos de seguimiento. Las flechas de los cursores remotos son un 40 % más pequeñas.

## Asistente de estudio

**Consultar con ChatGPT** abre el chat oficial desde el dispositivo. **Transcribir manuscrito con ChatGPT** prepara un recorte y una instrucción de transcripción; al volver, **Pegar transcripción** inserta texto editable junto al manuscrito. La tablet funciona sin la PC, con internet y transferencia manual. La conexión con PC sigue siendo una opción explícita. Se retiraron los modelos locales y Datalab; no se usan claves de OpenAI. El flujo vigente está en [ChatGPT personal](ASISTENTE_LOCAL.md).

## Conexión de Vercel

Vercel sirve la página; las cuentas, pizarras compartidas, archivos y WebSockets se atienden en el servidor de la PC a través de Cloudflare. Una dirección de túnel rápido puede caducar, provocando HTTP 502 aunque la PC responda localmente. Al reemplazarla hay que actualizar tanto `vercel.json` como `PIZARRA_WS_ORIGIN` y desplegar nuevamente. Una dirección permanente requiere configurar un túnel con nombre y dominio propio.
