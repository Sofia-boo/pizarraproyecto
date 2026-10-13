# Estudiar sin internet en la tablet

1. Abrí https://pizarraproyecto.vercel.app con internet. En el inicio o en Perfil, esperá **App lista para usar sin internet**. Se descargan también las herramientas de gráficos y el lector de PDFs.
2. Podés instalarla desde **Descargar app para tablet**. En Android usá Chrome; en iPad, Safari → Compartir → Agregar a pantalla de inicio. También funciona desde el navegador sin instalarla.
3. Abrí las pizarras que vas a necesitar. En **Mis pizarras → Preparar esta pizarra sin conexión**, esperá la confirmación de copia completa. Esto verifica y descarga todas sus imágenes y páginas de PDF, incluso las que están fuera de la vista.
4. Si hay una actualización descargada, cerrá todas las ventanas de la app y volvé a abrirla antes de salir.

Sin internet podés abrir las pizarras privadas y las compartidas descargadas, dibujar, borrar, escribir, importar imágenes y PDFs del dispositivo, editar tablas y hojas A4, usar calculadora, matrices, gráficos, EDO y tarjetas de estudio. El código C++ se puede editar y guardar.

El **Asistente de estudio local**, disponible en IA, también puede usarse sin conexión después de descargar sus modelos por separado en cada dispositivo. Incluye preguntas y lectura aproximada de imágenes. Consultá [su preparación y limitaciones](ASISTENTE_LOCAL.md).

El reconocimiento OCR (Datalab y el modelo del servidor), la ejecución de C++, los videos de YouTube, los nuevos enlaces multimedia y la colaboración en vivo necesitan conexión. No se descargan videos de YouTube. Una pizarra que nunca abriste en esa tablet necesita internet para obtener su primera copia.

Las modificaciones de una compartida se guardan en la tablet como cambios pendientes. Al recuperar conexión, con la sesión válida y el servidor disponible, se sincronizan automáticamente. Si venció la sesión, volvé a ingresar con la misma cuenta; la copia pendiente permanece guardada. Las privadas siguen siendo privadas y no se publican automáticamente.

El almacenamiento pertenece al navegador y al dominio de la app en ese dispositivo. No borres sus datos si querés conservar las pizarras. La app solicita almacenamiento persistente; el navegador decide si lo concede. Descargá respaldos desde **Mis pizarras → Descargar respaldo** para conservar otra copia.

## Desarrollo y verificación

El modo sin conexión requiere HTTPS (o localhost) y una compilación de producción; `npm run dev` no instala el service worker. Para probar localmente:

```powershell
npm.cmd run build
npm.cmd run preview
```

`scripts/pwa-build.ts` genera un service worker por versión y precarga todos los recursos compilados. El HTML y los archivos se sirven desde la misma versión instalada; una actualización incompleta no sustituye la anterior. Las rutas de API, OCR y las respuestas de sesión no se guardan en la caché de la aplicación. Las pizarras, archivos y cambios pendientes se guardan en IndexedDB.
