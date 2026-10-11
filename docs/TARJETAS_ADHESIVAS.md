# Tarjetas de estudio en la pizarra

Revisión del 11 de octubre de 2026. Publicada en https://pizarraproyecto.vercel.app.

## Uso

1. Abrí **Tarjetas de estudio** y elegí un mazo, por ejemplo **General**.
2. Usá **Poner mazo en pizarra** para copiarlo completo, o entrá a **Mis tarjetas**,
   marcá las que quieras y elegí **Poner seleccionadas en pizarra**.
3. Las copias aparecen como notas adhesivas de colores, separadas en filas.
   En pantallas angostas se colocan en una columna. Se admiten hasta 100 por vez.
4. Seleccioná una tarjeta para **Mostrar respuesta / Mostrar pregunta** o
   **Editar tarjeta adhesiva**. El editor muestra el contenido completo aunque
   sea demasiado largo para verse dentro de la nota.
5. Se pueden mover, redimensionar, girar, copiar, borrar y deshacer como las
   demás notas. Una inserción de varias tarjetas se deshace en un solo paso.

Se copian pregunta, respuesta y nombre del mazo. No se copian identificadores
de tarjetas personales, historial de repasos, fechas ni datos de la cuenta.
Editar una copia no modifica la tarjeta original ni su repetición espaciada.
En una pizarra compartida, las copias son visibles y editables por quienes
tengan permiso de edición. Girar una tarjeta cambia su cara visible para todos.
Las privadas siguen guardándose en el navegador de cada dispositivo.

## Implementación y compatibilidad

- `src/canvas/studyCards.ts`: copias independientes y distribución en el lienzo.
- `FlashcardPanel`: selección individual, selección del mazo y acciones de inserción.
- `App`, `RightMathDock`, `visualObjects`, `visualRendering`, `VisualObjectInspector`:
  integración con notas nativas, editor, caras, guardado, historial y sincronización.
- `reconocimiento_local/visual_objects.py`: validación del contenido opcional.
- No hay dependencias nuevas ni migraciones. No se reescriben pizarras anteriores.
  Las notas comunes conservan su formato. El campo opcional `note.study` guarda
  preguntas de hasta 10.000 caracteres y respuestas de hasta 20.000.
  `note.text` mantiene una vista de compatibilidad de hasta 10.000 caracteres.
- Ediciones simultáneas de campos diferentes se combinan. Si ambas personas
  editan el mismo campo, el editor conserva las versiones completas para revisarlas.
- Se corrigió el solapamiento del perfil con el acceso a tarjetas en pantallas
  pequeñas. Los errores 502/503/504 de inicio de sesión explican que el servidor
  compartido no está disponible y mantienen el acceso a las privadas del dispositivo.

## Conexión de Vercel activa

El usuario revocó explícitamente la restricción anterior y autorizó despliegues
automáticos el 11 de octubre. Se publicó el commit `340e9e1e` en `main`, Vercel
sirve la versión nueva y el backend público se reinició con la misma carpeta
de datos y el origen WebSocket actualizado. El error 502 quedó resuelto.
Se creó un respaldo consistente de SQLite y del frontend anterior antes de
reiniciar. El registro local de conexión se actualizó y se retiró el túnel vencido.
La PC, el servidor y el túnel deben permanecer encendidos para las compartidas.

## Verificación

Las pruebas cubren contenido completo, selección por mazo, copias independientes,
deshacer, recargar, formato móvil, validación del backend y edición por otro
participante mediante HTTP y WebSockets reales con almacenamiento temporal.
- `npm.cmd test`: 38 pruebas aprobadas.
- `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v`:
  5 pruebas aprobadas con almacenamiento aislado.
- `$env:PIZARRA_TEST_PREVIEW='1'; npm.cmd run test:browser`: 13 pruebas aprobadas
  en Chrome, incluidas colaboración real y pantalla de 390 × 844.
- `npm.cmd run build -- --outDir dist-fase1`: aprobado. Se mantiene el aviso
  previo de paquetes grandes (matemáticas, PDF y Plotly).
- Lint de los archivos modificados: sin errores; se mantienen advertencias
  previas de React en `App` y `AnonymousGate`.
- `git diff --check`: aprobado.

Vista local actualizada: http://127.0.0.1:5178, con la carpeta separada
`datos/revision-fase1`. Backend público de puerto 8765 actualizado conservando `datos`.
Capturas de las pruebas: `test-results/tarjetas-adhesivas.png`,
`test-results/tarjetas-seleccion-movil.png` y
`test-results/tarjeta-adhesiva-movil.png` (archivos ignorados por Git).

La comprobación pública en Chrome de 390 × 844 verificó registro, cierre de
sesión, inicio de sesión desde la pantalla real, WebSocket/presencia, inserción
de una tarjeta adhesiva, guardado en la PC y recarga con sesión y contenido
conservados. Se eliminaron únicamente la cuenta y pizarra temporales de prueba.
El registro está en `logs/prueba-produccion.json` y la captura en
`logs/tablet-produccion.png`, ambos ignorados por Git.

Próximo paso: configurar un túnel permanente para que no cambie la dirección
del backend cuando se reinicie la conexión temporal.
