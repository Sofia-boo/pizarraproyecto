# Estudiar sin internet en la tablet

1. Abrí https://pizarraproyecto.vercel.app con internet. En el inicio o en Perfil, esperá **App lista para usar sin internet**. Se descargan también las herramientas de gráficos y el lector de PDFs.
2. Podés instalarla desde **Descargar app para tablet**. En Android usá Chrome; en iPad, Safari → Compartir → Agregar a pantalla de inicio. También funciona desde el navegador sin instalarla.
3. Abrí las pizarras que vas a necesitar. En **Mis pizarras → Preparar esta pizarra sin conexión**, esperá la confirmación de copia completa. Esto verifica y descarga todas sus imágenes y páginas de PDF, incluso las que están fuera de la vista.
4. Si hay una actualización descargada, tocá **Actualizar app**. La pizarra se guarda antes de recargar; no hace falta borrar datos ni cerrar todas las pestañas. Las versiones antiguas sin ese botón reciben la nueva versión al recargar después de que termine de descargarse.

Sin internet podés abrir las pizarras privadas y las compartidas descargadas, dibujar, borrar, escribir, importar imágenes y PDFs del dispositivo, editar tablas y hojas A4, usar calculadora, matrices, gráficos, EDO y tarjetas de estudio. El código C++ se puede editar y guardar.

**Consultar con ChatGPT**, disponible en IA, requiere conexión para abrir la interfaz oficial. Las respuestas ya pegadas y su formato se conservan localmente y se pueden insertar sin conexión. Consultá [su funcionamiento](ASISTENTE_LOCAL.md).

Consultar y transcribir con ChatGPT, la ejecución de C++, los videos de YouTube, los nuevos enlaces multimedia y la colaboración en vivo necesitan conexión. Podés pegar una transcripción ya copiada sin internet. Se retiraron Datalab y los reconocedores locales. No se descargan videos de YouTube. Una pizarra que nunca abriste en esa tablet necesita internet para obtener su primera copia.

Las modificaciones de una compartida se guardan en la tablet como cambios pendientes. Al recuperar conexión, con la sesión válida y el servidor disponible, se sincronizan automáticamente. Si venció la sesión, volvé a ingresar con la misma cuenta; la copia pendiente permanece guardada. Las privadas siguen siendo privadas y no se publican automáticamente.

El almacenamiento pertenece al navegador y al dominio de la app en ese dispositivo. No borres sus datos si querés conservar las pizarras. La app solicita almacenamiento persistente; el navegador decide si lo concede. Descargá respaldos desde **Mis pizarras → Descargar respaldo** para conservar otra copia.

## Desarrollo y verificación

El modo sin conexión requiere HTTPS (o localhost) y una compilación de producción; `npm run dev` no instala el service worker. Para probar localmente:

```powershell
npm.cmd run build
npm.cmd run preview
```

`scripts/pwa-build.ts` genera un service worker por versión y precarga todos los recursos compilados. El HTML y los archivos se sirven desde la misma versión instalada; una actualización incompleta no sustituye la anterior. Las rutas de API y las respuestas de sesión no se guardan en la caché de la aplicación. Las pizarras, archivos y cambios pendientes se guardan en IndexedDB.
