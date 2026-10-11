# Reconocimiento, mazos en una tarjeta y capas de Excel

11 de octubre de 2026.

- Se registró `/recognize/text-local`, que la interfaz ya utilizaba pero no
  existía en el backend. El montaje estático devolvía 405 a ese POST.
  Se conserva `/recognize/words` y se reutiliza el reconocedor geométrico local
  con las muestras de letras existentes. También se registra la ruta de tinta
  del calendario y se restauran las rutas locales de números/símbolos.
- Las muestras matemáticas iniciales se copian a `datos/math_samples.json`
  solamente si ese archivo no existe. Las muestras personales no se reemplazan.
  Enseñar símbolos sigue requiriendo permisos de administrador. El reconocedor
  matemático geométrico lee expresiones lineales; no interpreta fórmulas de dos
  dimensiones ni garantiza transcribir toda escritura correctamente.
- Se quitó el máximo de 80 en las notas y tarjetas. Se admiten tamaños positivos
  finitos y decimales, incluyendo los producidos al redimensionar. Cambiar el
  color de una nota ampliada ya no queda bloqueado por la validación del formulario.
- El editor de Excel y sus botones del lienzo quedan debajo de la barra principal,
  paneles y diálogos. Las celdas y su barra de fórmulas siguen siendo editables.
- **Poner mazo en una sola tarjeta** copia el mazo en una única nota adhesiva.
  **Seleccionadas en una sola tarjeta** permite copiar un subconjunto.
  Al seleccionarla aparecen **Anterior tarjeta**, **Mostrar respuesta/pregunta**,
  **Repetir tarjeta** y **Siguiente tarjeta**. Al llegar al final vuelve al inicio.
  Repetir vuelve a mostrar la pregunta actual; no altera el calendario personal
  de repetición espaciada. Se mantiene la opción de insertar notas separadas.
- Editar una pregunta o respuesta de este mazo conserva la edición al cambiar de
  tarjeta. Todo el mazo pertenece a la nota de la pizarra; no guarda identificadores
  ni historial de las tarjetas personales. En pizarras compartidas sus cambios
  de cara y posición son compartidos, como el resto de la nota.
- No se agregan dependencias ni migraciones de base de datos. El contenido del
  mazo es opcional, por lo que las notas y tarjetas anteriores siguen funcionando.

Las pruebas incluyen reconocimiento real de muestras con almacenamiento aislado,
guardado de fuentes grandes/decimales, edición de colores, navegación de mazos,
recarga y solapamiento de tablas con botones y menús mediante `elementFromPoint`.

Validación: 39 pruebas de TypeScript, 7 de backend y 16 de navegador aprobadas.
Compilación de producción y lint de los componentes modificados aprobados.
