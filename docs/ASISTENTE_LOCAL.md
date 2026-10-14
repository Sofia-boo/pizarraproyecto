# ChatGPT personal dentro de la pizarra

**IA → Consultar con ChatGPT** abre directamente un chat fijo dentro de la app. El servidor de la PC automatiza una ventana real de Chrome con tu cuenta personal de ChatGPT. Funciona desde la PC y desde la tablet con conexión, sin una API de OpenAI, Scrapeless o Scrapingdog y sin claves nuevas.

## Primera conexión

1. Encendé la PC y dejá funcionando el servidor de las pizarras.
2. Ingresá con tu cuenta de la pizarra y abrí **IA → Consultar con ChatGPT → Conectar mi ChatGPT en la PC**.
3. En la ventana de Chrome normal que aparece **en la PC**, iniciá sesión directamente en ChatGPT. Durante este paso no se activa CDP, Playwright ni control de automatización. Si se solicita una verificación, completala allí. La pizarra no pide tu contraseña ni resuelve verificaciones.
4. Cuando veas tu chat, volvé a la pizarra y tocá **Ya inicié sesión · activar**. La conexión pide cerrar normalmente esa ventana del perfil dedicado y vuelve a abrir el mismo perfil para automatizar las consultas. No cierra tu Chrome habitual ni copia cookies.
5. Cuando indique **conectado desde la PC**, escribí la pregunta y pulsá **Enviar**. En la tablet usá la misma cuenta de la pizarra para utilizar ese perfil conectado.

Si Google muestra «Es posible que el navegador o la aplicación no sean seguros», elegí **Iniciar sesión en Chrome normal** para volver al paso de acceso sin automatización. Si Chrome sigue abierto en varias ventanas del perfil dedicado, cerralas antes de pulsar Activar. Google puede rechazar navegadores controlados por software; esta separación evita conectar el controlador durante el inicio de sesión, pero el acceso final depende de Google y de tu cuenta. [Ayuda de Google](https://support.google.com/accounts/answer/7675428).

Si ChatGPT pide verificar que sos humano, la app pausa las consultas y muestra **Completar verificación en Chrome normal**. Ese botón vuelve a abrir el perfil dedicado sin conectar el controlador. Completá el acceso en la PC y activá únicamente cuando veas el chat y puedas escribir. La app no pulsa verificaciones, no recarga desafíos ni activa de nuevo la automatización por su cuenta. El ejercicio y los adjuntos pendientes se conservan. Si solo aparece el logo de ChatGPT, se indica **cargando** en vez de asumir que falta iniciar sesión; el estado se comprueba sin recargar. Si vuelve a bloquearse incluso en Chrome normal, no puede garantizarse el acceso automatizado: se puede continuar en el navegador y usar **Pegar respuesta en la pizarra**.

Chrome conserva su sesión en un perfil dedicado por usuario, fuera del repositorio: `%LOCALAPPDATA%/PizarraChatGPT/ChromeProfiles/`. No se comparte el perfil habitual de Chrome ni el de otros usuarios. La aplicación no lee ni exporta cookies, contraseñas o tokens de ChatGPT. Las credenciales se introducen únicamente en Chrome de la PC, nunca en la tablet a través del servidor. El puerto de control del navegador queda vinculado a `127.0.0.1`; no se publica en Vercel ni en el túnel.

## Ejercicios y respuestas

- **Adjuntar → Selección de la pizarra** permite marcar una parte de un PDF, una imagen o un manuscrito. El recorte queda adjunto a la pregunta; al enviar se sube automáticamente a ChatGPT, sin descargarlo y volverlo a seleccionar.
- **Adjuntar → Archivo o imagen…** permite elegir hasta tres PNG, JPEG, WebP o PDF, con un máximo total de 20 MB. La disponibilidad final depende de los límites de tu cuenta de ChatGPT.
- La respuesta aparece en el chat de la app. **Insertar en pizarra** coloca una imagen con fórmulas y títulos legibles. **Texto editable** convierte la notación matemática básica a texto para editarla.
- **Pegar respuesta en la pizarra** lee el portapapeles cuando lo pulsás y la inserta con formato en un paso. Si el navegador no autoriza leerlo, se muestra un cuadro para pegar manualmente.
- El chat, los adjuntos pendientes y la referencia a su conversación se guardan localmente por cuenta y pizarra. Una consulta que siga ejecutándose puede recuperarse al cerrar y reabrir el panel. Los trabajos del servidor son temporales y desaparecen al reiniciarlo.

El servidor envía cada consulta una vez y no la reintenta automáticamente si el resultado es incierto. Si Chrome ya tiene un borrador o una respuesta en curso, hay que resolverlo allí antes de enviar otra consulta. Cada pizarra conserva la referencia a su conversación para continuarla sin mezclar ejercicios de otras pizarras.

La conexión admite tanto los controles anteriores como el editor actual con nombre accesible «Pregunta a ChatGPT». Los adjuntos se cargan en el selector de archivos general, no en la entrada de cámara ni en la de fotos. La lectura reconoce los nuevos bloques de respuesta y conserva las fórmulas. Al reiniciar el servidor se desconecta el controlador sin cerrar Chrome; el usuario autenticado puede recuperar únicamente su perfil dedicado que ya tenía activada la conexión. La recuperación no abre nuevos navegadores, no activa el control durante el acceso manual y no exporta la sesión.

## Scrapling

Se usa Scrapling 0.4.15 para extraer y estructurar únicamente el fragmento de la nueva respuesta del asistente. Se preservan las anotaciones LaTeX originales de KaTeX, los títulos, las listas y el código. El fragmento se limpia de formularios, controles y atributos ajenos al contenido antes de procesarlo. La navegación y los adjuntos se mantienen en Chrome con Playwright; Scrapling no reemplaza el inicio de sesión ni se usa para eludirlo.

El parser funciona en memoria con `adaptive=False`: no guarda muestras de la página, no recibe páginas de acceso y no usa fetchers, proxies, resolución de CAPTCHA ni exportación de cookies. Instalación: `python -m pip install -r requirements.txt`. [Parser de Scrapling](https://scrapling.readthedocs.io/en/latest/parsing/main_classes.html).

## Requisitos y límites

El servidor necesita Node.js, `npm install` (incluye Playwright) y Chrome instalado. Debe ejecutarse en la sesión de escritorio de Windows del usuario, no en un servicio sin escritorio. Vercel aloja la página y conecta con ese servidor; no ejecuta Chrome.

La PC debe permanecer encendida y conectada. ChatGPT no funciona sin internet. Las pizarras preparadas sin conexión y las respuestas ya recibidas sí se pueden usar e insertar localmente. El APK y la PWA existentes sirven para este flujo; no hace falta instalar una extensión en la tablet.

La interfaz dentro de la pizarra es propia: el navegador oficial se ejecuta en la PC. No es un iframe de ChatGPT ni un chat oficial embebido en Android. La automatización depende de la interfaz web de ChatGPT; cambios de interfaz, límites de cuenta o verificaciones pueden interrumpirla. No se eluden controles de acceso ni desafíos del sitio.

## Validación

Se probaron el arranque y cierre de Chrome, la autenticación de las rutas, el aislamiento entre usuarios, la reconexión sin cerrar la ventana ni perder borradores, la ausencia de reenvíos duplicados, el recorte exacto de un PDF rotado, los adjuntos y la inserción de fórmulas. También se envió una consulta real simple «2 + 2» en la sesión del propietario y se comprobó la lectura de su respuesta «4» con los nuevos controles; no se reenvió la pregunta después del cambio del lector. Los adjuntos PDF y las fórmulas se validaron con páginas simuladas que reproducen ambas interfaces. Las pruebas automatizadas usan bases de datos y perfiles aislados.

Archivos principales: `reconocimiento_local/chatgpt_browser.py`, `scripts/chatgpt-browser.mjs`, `scripts/chatgpt-page.mjs` y `src/components/ChatGPTConsultation.tsx`.

Referencias: [Playwright: conexión a Chrome](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [adjuntar archivos](https://playwright.dev/docs/input#upload-files). Los ejemplos de [Scrapeless](https://docs.scrapeless.com/es/docs/ai-scraper/scrapers/chatgpt/) y [Scrapingdog](https://www.scrapingdog.com/blog/scrape-chatgpt-with-python/) dependen de servicios externos con clave y no se utilizan aquí.
