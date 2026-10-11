# OCR, colaboración y ecuaciones diferenciales

## Datalab

1. Creá tu cuenta en https://www.datalab.to/auth/sign_up con tu correo personal o institucional.
2. Consultá los planes vigentes en https://www.datalab.to/pricing. No se confirmó un programa estudiantil específico; no asumir que un correo universitario otorga uno.
3. Obtené la clave en https://www.datalab.to/app/keys y ejecutá en esta PC:

   `powershell -ExecutionPolicy Bypass -File .\configurar_datalab.ps1`

La clave queda en `datos/datalab.json`, excluido de GitHub. También se admite `DATALAB_API_KEY` como variable del proceso del servidor. Se lee por solicitud: no hace falta reiniciar después de configurar.

En el menú IA, las dos primeras opciones permiten transcribir la selección manuscrita o elegir un PDF/imagen. La selección se convierte en una imagen; para transcribir **todas las páginas de un PDF**, elegí el archivo PDF original. El servidor usa la API actual `/api/v1/convert`, modo accurate, Markdown paginado, sin `max_pages` ni rangos que recorten el documento. Conserva encabezados y pies y comunica las páginas que Datalab indique como fallidas. La exactitud del OCR depende del documento: revisá el resultado.

Se puede descargar la transcripción completa como `.md` o insertarla como texto editable sin eliminar el original. Las tareas y resultados pertenecen a la cuenta que los envió; se conservan en SQLite y se pueden reconsultar después de cerrar la ventana. El archivo se envía a Datalab y utiliza sus créditos. Sin clave se muestra un error explicativo y no se realiza ninguna llamada al proveedor. Los reconocedores locales antiguos siguen disponibles para compatibilidad y entrenamiento individual.

Referencias: https://documentation.datalab.to/docs/recipes/conversion/conversion-api-overview y https://documentation.datalab.to/api-reference/convert-result-check.

## EDO

Abrí **Opciones del gráfico → Ecuaciones diferenciales → Activar EDO**. Ingresá `f(x,y)` (por ejemplo `x-y`) y la condición inicial `x0`, `y0`. Podés activar por separado el campo direccional y la solución.

Se resuelven EDO explícitas de primer orden `dy/dx=f(x,y)` numéricamente con Runge–Kutta de cuarto orden y paso adaptativo por duplicación. No es un solucionador simbólico general ni de sistemas o ecuaciones de orden superior. El campo y la solución se regeneran al navegar por el gráfico. Las singularidades interrumpen la integración, sin unir puntos a través de ellas. La configuración forma parte del gráfico compartido y de las copias locales.

## Corrección cooperativa

La subida de imágenes usaba `INSERT ... VALUES` sin nombres de columna, incompatible con la columna de propietario añadida a la tabla. El error 500 bloqueaba el guardado de toda la escena. Se especifican las columnas y se conserva el propietario al actualizar un archivo existente.

Las relaciones entre pizarra y archivos se guardan en la misma transacción que la escena antes de emitir la notificación WebSocket. Las descargas para la copia offline ya no retrasan la aplicación de gráficos y tablas. Una eliminación concurrente prevalece sobre la edición de un objeto existente, evitando que reaparezca. Los participantes con enlace de edición pueden modificar y borrar objetos de cualquier autor; los enlaces que el dueño creó expresamente de solo lectura siguen teniendo ese permiso.

## Recepción sin esperas adicionales

Los cambios pequeños de objetos se envían en la notificación WebSocket, con su versión de origen. Una pantalla que tiene esa misma versión los aplica directamente, sin volver a descargar la pizarra completa. Los mensajes perdidos, cambios de orden, datos antiguos sin identificadores y actualizaciones mayores a 512 KB usan la recuperación por HTTP. Se conserva la cámara local.

Tener abierto un editor de nota, texto o tabla no bloquea la llegada de otros objetos. Se conserva el borrador del editor. Los cambios pendientes de guardar, trazos y arrastres activos se terminan antes de aplicar una actualización para preservar el trabajo local; las copias con cambios sin conexión se reconcilian antes de recibir parches.

El autoguardado de compartidas comienza después de 80 ms de inactividad. Las imágenes comienzan a transferirse al guardarlas localmente, con hasta cuatro subidas simultáneas, y sus metadatos se publican después de que el servidor tenga el archivo. Los PDF se insertan y guardan página por página, mientras se procesan las siguientes. La apertura de una pizarra muestra sus objetos sin esperar la descarga de todas sus imágenes; pantalla y copia offline comparten una misma descarga por archivo.

Las transferencias reales, la conversión del PDF y la preparación de YouTube o Plotly siguen dependiendo del tamaño y la conexión. Las pruebas con dos cuentas verifican recepción sin GET adicional incluso con un borrador abierto, y recepción de la primera página de PDF mientras la segunda subida permanece deliberadamente detenida.
