# Consultar con ChatGPT

El asistente generativo local fue reemplazado por **IA → Consultar con ChatGPT**. El reconocimiento local de escritura sigue siendo una herramienta independiente y conserva sus datos. Las conversaciones y modelos antiguos no se borran automáticamente, pero el generador local ya no se carga ni se descarga.

## Uso

1. Abrí **IA → Consultar con ChatGPT** y pulsá el botón del mismo nombre.
2. Iniciá sesión con tu cuenta personal en `https://chatgpt.com/`. Las fotos, las preguntas y las respuestas se manejan en la interfaz oficial.
3. Cerrá la ventana con su botón de cierre o con Atrás para regresar al ejercicio guardado.
4. Copiá la respuesta desde ChatGPT y pegala en **Respuesta de ChatGPT**. El botón **Pegar respuesta** usa el portapapeles únicamente cuando lo pulsás; también podés mantener pulsado el cuadro y elegir Pegar.
5. **Insertar en pizarra con formato** coloca una imagen con los títulos y las fórmulas renderizadas. **Insertar como texto** coloca texto editable y convierte la notación matemática básica a texto legible.

Para llevar una parte de un PDF, una imagen o un manuscrito, elegí **Llevar un recorte del ejercicio → Seleccionar área de la pizarra → Descargar recorte**. Adjuntá ese archivo manualmente en ChatGPT. La selección no envía automáticamente el documento completo.

El borrador pegado y el recorte se guardan en este dispositivo, por cuenta y pizarra. No se leen automáticamente las conversaciones de ChatGPT. No hay API de OpenAI, claves, formulario de acceso, iframe de ChatGPT ni acceso a sus cookies desde la aplicación.

## Tablet Android

Descargá e instalá **Pizarra + ChatGPT** desde el enlace **Descargar app Android con ventana de ChatGPT** de la pantalla de inicio o desde el panel. Android puede pedir habilitar la instalación desde Chrome. Después abrí esa aplicación.

El APK abre la pizarra mediante una Trusted Web Activity de Chrome y abre ChatGPT mediante Chrome Custom Tabs. Usa el almacenamiento del mismo dominio en Chrome; no crea un WebView con otra copia de tus pizarras. Si antes usabas otro navegador o perfil, exportá e importá tus pizarras para trasladarlas.

En pantallas compatibles se solicita una ventana lateral de hasta 520 dp; en pantallas pequeñas se solicita una ventana parcial inferior. Chrome decide el tamaño final y puede usar pantalla completa. No es un ChatGPT embebido en el panel HTML. En la PWA y en la PC se abre una ventana o pestaña del navegador.

La autenticación la gestiona el navegador. El APK no recibe ni almacena credenciales, contraseñas, cookies o respuestas de ChatGPT. ChatGPT requiere conexión; las pizarras preparadas sin conexión y las respuestas ya pegadas siguen disponibles localmente.

## Compilación y validación

El proyecto Android está en `android/`. `scripts/build-android.ps1` compila, ejecuta Android Lint, verifica la firma y genera `public/downloads/pizarra-chatgpt.apk` y `public/.well-known/assetlinks.json`.

La compilación local utiliza JDK 17, Gradle 8.11.1 y Android SDK 36 en `.android-build/`. Conservar **fuera de Git** `.android-build/pizarra-release.jks` y `.android-build/signing.properties`: hacen falta para firmar futuras actualizaciones del mismo APK. El certificado público de `assetlinks.json` debe corresponder al APK publicado. El APK no se precarga en la caché sin conexión de la página.

Las pruebas de navegador comprueban apertura de la URL oficial, regreso a la pizarra guardada, recorte de PDF rotado, pegado de Markdown y fórmulas, inserción y borrador tras recargar. Se verificaron compilación, Android Lint y firma; la apertura real del Custom Tab requiere probar el APK en la tablet física.

Referencias: [Custom Tabs parciales](https://developer.chrome.com/docs/android/custom-tabs/guide-partial-custom-tabs), [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start), [interfaz web de ChatGPT](https://learn.chatgpt.com/docs/web).
