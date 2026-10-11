# Árboles binarios y recuperación de microcortes del lápiz

Implementado el 11 de octubre de 2026 sobre la pizarra existente.

## Árboles

- Libro **Elementos académicos → Árbol desde expresión…** abre el editor.
  Se conserva el botón habitual **Árbol binario** para insertar la plantilla.
- Se puede crear un árbol visual, insertar la expresión como texto editable
  en la pizarra o copiarla al portapapeles.
- Al seleccionar un árbol completo aparece **Expresión del árbol**. Lee las
  etiquetas y los conectores actuales; también reconoce las plantillas antiguas.
  Si se desagrupó, hay que seleccionar todos sus nodos y conexiones.
- La representación usa `(nodo izquierda derecha)`, hojas sin paréntesis y
  `.` para una rama vacía. Los nombres con espacios se escriben entre comillas.
  La expresión de la imagen funciona directamente:

  ```text
  (* (* A (* O (* P .))) (* U T))
  ```

  Otro ejemplo: `(8 (4 2 6) (12 . 14))`.
- Izquierda y derecha se determinan por la posición horizontal de los hijos.
  Mover un hijo al otro lado puede cambiar la expresión obtenida.
- Los nuevos árboles son grupos de figuras y conectores nativos, con edición,
  movimiento, copiar/pegar, deshacer, guardado y sincronización habituales.
  Crear desde una expresión genera una copia; no reemplaza el árbol original.
- Se validan la sintaxis, los ciclos, padres múltiples y ramas desconectadas.
  Límite: 127 nodos, 24 niveles, 80 caracteres por etiqueta y 8000 por expresión.
  Un árbol grande puede requerir alejar el zoom.

## Lápiz digital

- Ante `pointerup`, `pointercancel`, pérdida de captura o un movimiento sin
  contacto, se conserva la tinta ya recibida y se espera **100 milisegundos**.
- Si el lápiz vuelve con contacto dentro de ese plazo y a **18 píxeles de
  pantalla o menos** del último punto, continúa el mismo trazo, incluido su
  historial y transmisión en vivo. No se añade una segunda acción a Deshacer.
- Si vuelve lejos, cambian el color/grosor/resaltador, cambia la cámara o pasa
  ese plazo, comienza otro trazo. Una pausa de **un segundo** siempre separa.
- Durante la espera no se dibujan movimientos de hover ni se inventan puntos
  mientras el lápiz está levantado. La unión breve interpola entre los dos
  contactos reales; no puede reconstruir un movimiento que el hardware no envió.
- Mouse, formas, borrador y navegación con dedos mantienen su comportamiento.
  Se rechaza la palma también durante esa espera breve. La recuperación sirve
  asimismo al dibujar sobre videos.
- El plazo y distancia se concentran en `src/canvas/penRecovery.ts`. Son valores
  conservadores iniciales; falta comprobar la sensibilidad con el lápiz Lenovo
  físico. No se puede distinguir perfectamente una pérdida de contacto de una
  levantada intencional igualmente breve y cercana.

## Verificación y entrega

- Pruebas unitarias: sintaxis de la imagen, ramas vacías, objetos antiguos,
  etiquetas editadas, límites, grafos inválidos y reglas de recuperación.
- Navegador Chrome: expresión → árbol → expresión, errores sin insertar objetos,
  deshacer, recarga y panel móvil; entrada de lápiz mediante CDP con cancelación,
  continuación, hover y pausa de un segundo.
- La prueba de colaboración usa dos cuentas temporales y un backend/SQLite
  aislados: comprueba el árbol nuevo y los mensajes reales de un trazo recuperado
  (un inicio, un final, sin cancelación) recibido por el otro usuario.
- Compilación en `dist-fase1`, vista local en http://127.0.0.1:5178.
  No hay dependencias nuevas ni migraciones; no se publican cambios en Vercel
  ni se reinicia el servidor público.

Comandos: `npm test`, `npm run build -- --outDir dist-fase1`,
`PIZARRA_TEST_PREVIEW=1 npm run test:browser` (en PowerShell, asignar la variable
con `$env:PIZARRA_TEST_PREVIEW='1'` antes de ejecutar), y las pruebas Python
existentes en `tests/`.
