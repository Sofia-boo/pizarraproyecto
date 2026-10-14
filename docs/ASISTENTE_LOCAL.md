# ChatGPT desde la pizarra

**IA → Consultar con ChatGPT** usa por defecto **En este dispositivo**. Abre la interfaz oficial de ChatGPT en la tablet o PC, con la cuenta personal del usuario y sin depender del servidor de la computadora. Este modo no usa la API de OpenAI, claves, Scrapling ni automatización del navegador. La app no recibe credenciales ni cookies de ChatGPT.

## Usar la tablet sin la PC

1. Abrí la app Android, la PWA o `https://pizarraproyecto.vercel.app`. Si el servidor de las compartidas está apagado, usá **Abrir privadas y copias de este dispositivo**. Las compartidas necesitan una copia previamente guardada para trabajar sobre ellas sin ese servidor.
2. Entrá a **IA → Consultar con ChatGPT → En este dispositivo**.
3. Prepará la pregunta y usá **Copiar pregunta**. **Adjuntar → Selección de la pizarra** permite marcar un recorte con el dedo o lápiz; **Archivo o imagen…** elige fotos o PDFs del dispositivo.
4. Podés **Descargar** cada archivo para adjuntarlo en ChatGPT. Cuando el navegador lo admite, **Compartir consulta…** abre el menú del sistema con la pregunta y los archivos elegidos. Elegí ChatGPT si aparece entre las aplicaciones; su disponibilidad depende de lo que tengas instalado. La pizarra no elige un destinatario ni envía la consulta por su cuenta.
5. Pulsá **Abrir ChatGPT en este dispositivo**. Iniciá sesión directamente en ChatGPT y hacé la consulta allí. Si cerrás su ventana, **Volver a abrir ChatGPT** abre otra. El enlace **Abrir directamente** sirve también si el navegador bloquea ventanas emergentes.
6. Copiá la respuesta desde ChatGPT, volvé a la pizarra y pulsá **Pegar respuesta en la pizarra**. Se inserta con formato y fórmulas. Si Chrome no permite leer el portapapeles, se muestra un cuadro para pegar manualmente.

El ejercicio y el borrador permanecen en el dispositivo. La consulta y la respuesta se gestionan en la interfaz oficial; la pizarra no lee el chat oficial ni recoge sus respuestas automáticamente. Las respuestas anteriores del modo con PC se conservan.

El APK existente abre ChatGPT mediante Android Chrome Custom Tabs, con panel lateral cuando Chrome lo admite. En la PWA o navegador se abre una ventana o pestaña aparte. No hace falta reinstalar el APK para estos cambios web. Chrome gestiona el acceso a la cuenta; no se utiliza un WebView que almacene las credenciales en la app.

ChatGPT necesita internet, aunque la PC puede estar apagada y la tablet puede usar otra red. Copiar preguntas, consultar lo guardado e insertar respuestas copiadas funcionan sobre las pizarras locales. Las pizarras compartidas se sincronizan cuando vuelve su servidor; este cambio no sustituye ese servidor.

## Conexión con PC opcional

**Con PC** conserva la integración anterior, con consultas y lectura de respuestas automatizadas. Debe elegirse expresamente; la elección se recuerda durante esa pestaña y se mantiene al recortar un ejercicio. Este modo necesita el servidor de la PC encendido, Chrome y la misma cuenta **de la pizarra** en ambos dispositivos.

1. Elegí **Con PC → Conectar mi ChatGPT en la PC**.
2. En Chrome normal de la PC, iniciá sesión y completá cualquier verificación. Durante este paso no se conecta el controlador. La pizarra no pide contraseñas ni resuelve verificaciones.
3. Cuando aparezca el chat y puedas escribir, tocá **Ya inicié sesión · activar**. El perfil se cierra normalmente y se vuelve a abrir para automatizar las consultas. No actives mientras solo aparezca el logo cargando o un desafío de verificación.
4. Cuando indique **conectado desde la PC**, escribí y pulsá **Enviar**. Las respuestas aparecen en el panel; **Insertar en pizarra** conserva las fórmulas y **Texto editable** permite editar la notación básica.

Si Chrome se cierra, la conexión descarta la referencia al navegador desconectado y espera el cierre del proceso propio antes de reabrir ese perfil. Al reiniciar el servidor, se puede recuperar únicamente el perfil dedicado ya activado de ese usuario. No se abre ni controla una ventana de acceso manual como parte de esa recuperación.

Google o ChatGPT pueden bloquear esta automatización. La extracción automática de respuestas puede incumplir los [términos de OpenAI](https://openai.com/policies/row-terms-of-use/); el modo **En este dispositivo** utiliza la interfaz oficial y transferencia manual. No se eluden verificaciones, límites ni restricciones.

## Guardado y límites

- El borrador, adjuntos y respuestas anteriores se guardan localmente por cuenta y pizarra. Cambiar de modo no los elimina. Una consulta pendiente en la PC queda conservada para retomarla en **Con PC**; el modo independiente no la reenvía ni consulta al servidor.
- Se admiten hasta tres PNG, JPEG, WebP o PDF, con un máximo de 20 MB en el panel. Los límites efectivos de subida a ChatGPT dependen de la cuenta y su interfaz.
- Los controles admiten toque, lápiz, mouse y teclado. Los botones táctiles tienen al menos 44 px. El panel se ajusta al área visible cuando abre el teclado Android; con poco espacio, oculta temporalmente el selector de modo y las instrucciones adicionales.
- En modo con PC, cada consulta se envía una vez. Si ya hay un borrador o una respuesta en curso en Chrome, debe resolverse allí. Los trabajos del servidor son temporales y no se reenvían automáticamente tras un reinicio.

## Implementación de la conexión opcional

Chrome conserva su perfil por usuario fuera del repositorio, en `%LOCALAPPDATA%/PizarraChatGPT/ChromeProfiles/`. La app no lee ni exporta cookies, contraseñas o tokens. El control CDP solo escucha en `127.0.0.1`, nunca en Vercel ni en el túnel. Vercel aloja la página; el servidor de la PC ejecuta Chrome.

Scrapling 0.4.15 procesa únicamente el fragmento limpio de una nueva respuesta automatizada, preservando LaTeX, títulos, listas y código. Usa `adaptive=False`, no persiste muestras y no recibe páginas de acceso. La navegación y los adjuntos usan Playwright. Estos componentes no intervienen en el modo independiente.

## Validación

Las pruebas usan cuentas, bases de datos y perfiles temporales o servicios simulados; nunca reemplazan las pizarras reales. Se comprueban la ausencia de llamadas a `/api/chatgpt/` en modo independiente con la PC indisponible, apertura y reapertura del chat oficial simulado, descarga de recortes, menú de compartir, portapapeles, fórmulas, teclado y gestos en emulación Android. Falta la comprobación física de Custom Tabs y el menú de compartir en la Lenovo Tab M11.

La conexión opcional se prueba con Chrome real sin sesión, incluyendo cierre externo y reapertura del navegador en el mismo controlador. Una consulta simple real «2 + 2 → 4» se verificó durante el desarrollo previo; no se realizan nuevas consultas con la cuenta del usuario para estas pruebas.
