# Compartir y estudiar

En Perfil → Compartir pizarra actual aparece un código aleatorio de cuatro dígitos, válido durante 24 horas. El otro usuario inicia sesión y elige Perfil → Ingresar a la pizarra. Primero se guardan los cambios pendientes y después se abre la pizarra del código. Los enlaces de invitación anteriores siguen funcionando.

Un primer ingreso crea una pertenencia con permiso de edición y la ubica en la carpeta personal **Pizarra compartida**. Reingresar no crea duplicados ni modifica carpetas. El creador conserva la ubicación de su pizarra. Mover una compartida cambia únicamente la ubicación para esa cuenta; si se elige una carpeta privada, la ubicación queda guardada en ese dispositivo. Compartir una privada publica una copia y mantiene la carpeta local del creador.

El código requiere una sesión y tiene un límite de intentos. Solo el propietario puede generarlo. Al vencer, generar otro no borra la pizarra ni expulsa a sus participantes.

El seguimiento transmite centro, zoom y tamaño de pantalla para encuadrar la vista completa del otro usuario en la tablet. Moverse, dibujar o usar el teclado termina el seguimiento. Las pestañas de una misma cuenta conservan la cámara que cambió más recientemente; los latidos de otra pestaña no deben reemplazarla. Se evitan ciclos de seguimiento. Las flechas de los cursores remotos son un 40 % más pequeñas.

## Asistente sin conexión

- **Materiales de la pizarra** enumera todas las imágenes y páginas de PDF. Consultar adjunta una página a la IA local; Poner imagen coloca una copia en la pizarra.
- Los PDF importados a partir de esta versión conservan hasta 16.000 caracteres de texto por página. Al preguntar se buscan fragmentos relevantes en todas las páginas, con un contexto acotado para la tablet. Los PDF anteriores o escaneados se consultan seleccionando una página como imagen. No se procesan todos los archivos simultáneamente.
- **Comprobar matemática y dibujar** permite calcular expresiones reales y [derivar funciones en x con Math.js](https://mathjs.org/docs/reference/functions/derivative.html), sin servidor. Las igualdades aritméticas explícitas de respuestas matemáticas se comprueban y corrigen cuando son compatibles con la calculadora. Esto no verifica una demostración ni toda una solución.
- Los resultados comprobados se guardan por cuenta en este navegador y se recuperan como contexto para consultas relacionadas. Es memoria de cálculos verificados; no es entrenamiento ni modificación de pesos del modelo. Puede borrarse desde Almacenamiento de la IA.
- Se pueden escribir respuestas, activar su inserción automática, agregar un gráfico de una función y copiar imágenes disponibles. No se incorpora un modelo generador de fotografías.
- Las preguntas de seguimiento aparecen mientras la página está visible y hay actividad. Por defecto son cada diez minutos; se pueden desactivar o cambiar a cinco o veinte desde el asistente. Son avisos locales y no ejecutan inferencia pesada en segundo plano.
- Los manuscritos siguen teniendo selección manual. Su lectura puede ser imprecisa; no se escanea continuamente la escritura.

La IA necesita descargar sus modelos una vez por dispositivo. Para tener imágenes y PDF sin conexión también hay que preparar la copia de la pizarra. La colaboración y el OCR de Datalab necesitan internet y el servidor encendido.

## Conexión de Vercel

Vercel sirve la página; las cuentas, pizarras compartidas, archivos y WebSockets se atienden en el servidor de la PC a través de Cloudflare. Una dirección de túnel rápido puede caducar, provocando HTTP 502 aunque la PC responda localmente. Al reemplazarla hay que actualizar tanto `vercel.json` como `PIZARRA_WS_ORIGIN` y desplegar nuevamente. Una dirección permanente requiere configurar un túnel con nombre y dominio propio.
