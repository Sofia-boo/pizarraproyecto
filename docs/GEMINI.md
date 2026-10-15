# Consultas con Gemini

El menú IA usa Gemini 3.1 Flash-Lite desde el servidor. Permite preguntas, imágenes, recortes de la pizarra y PDF, con respuestas que se pueden insertar como elementos editables o como imagen. Funciona en PC y tablet con internet, sin Chrome automatizado ni permisos de accesibilidad.

Crear una clave en https://aistudio.google.com/apikey para un proyecto sin facturación. Guardarla como secreto `GEMINI_API_KEY` en las variables de entorno de producción del proyecto Vercel y volver a desplegar. Nunca usar un nombre `VITE_` ni guardar la clave en el repositorio, la app o el navegador.

El proveedor ofrece un nivel gratuito con cupos variables. La integración no activa facturación, compra créditos ni cambia a un modelo de pago cuando se agota el cupo. Si el proyecto de Google tiene facturación habilitada, Google puede cobrar según su configuración: la app no puede comprobar ni cambiar esa configuración con una clave de API. Mantener el proyecto sin facturación para usar únicamente el nivel gratuito.

Google indica que puede usar el contenido del nivel gratuito para mejorar sus productos. Solo se envían la consulta, los últimos mensajes de esa conversación y los archivos que el usuario adjunta. No se envía toda la pizarra automáticamente. Los borradores y chats se guardan en este dispositivo, por usuario y pizarra; eliminar un chat no borra sus elementos ya insertados.

Hasta tres archivos PNG, JPEG, WebP o PDF, con un máximo de 3 MB en total para respetar los límites de solicitudes de Vercel. Un PDF grande puede adjuntarse como recorte. La clave se mantiene en el servidor y no se devuelve en errores. Las consultas requieren una sesión de la pizarra, incluyendo cuentas gratuitas. No funcionan sin conexión; los chats ya guardados sí se pueden consultar e insertar.

Fuentes: https://ai.google.dev/gemini-api/docs/pricing y https://ai.google.dev/gemini-api/docs/image-understanding.
