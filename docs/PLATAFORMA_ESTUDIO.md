# Auditoría y arquitectura de la plataforma de estudio

Fecha: 10 de octubre de 2026. Punto de partida: `37ca2c97`.
Este documento describe el repositorio inspeccionado, no una aplicación nueva.

## Auditoría del código existente

| Área | Evidencia y estado actual |
| --- | --- |
| Lienzo y herramientas | `src/App.tsx`: Canvas infinito, lápiz/resaltador, goma por geometría, texto, formas, selección por área, movimiento, escala y rotación. Los objetos siguen en arreglos separados. |
| Operaciones de objetos | `snapshot`, `transformSelection`, `copySelected`, `pasteSelected`, `groupSelected`, `reorderSelected`: reutilizables. La copia de trazos conservaba el ID original: debe corregirse para evitar colisiones en la fusión colaborativa. |
| Notas, conectores y biblioteca académica | No existen notas adhesivas ni referencias entre extremos de flechas y objetos. Hay flechas y figuras básicas reutilizables para construirlos. |
| Marcos y presentación | No hay modelos ni controles de marcos. La cámara y el seguimiento de participantes ya existen y son reutilizables. |
| Colaboración | `reconocimiento_local/live_sync_api.py`: presencia, cursores, avances de trazos, versiones, cámara y reproducción compartida de YouTube. Una conexión por pizarra. El contenido se confirma por HTTP con versión optimista; el WebSocket avisa que hay que descargarlo. |
| Conflictos | `src/storage/merge.ts` y `saveBoard`: fusión de arreglos por ID ante HTTP 409; conserva cambios en objetos diferentes. Dos ediciones del mismo objeto aún pueden reemplazar propiedades ajenas. La fase 1 debe combinar propiedades y conservar variantes del texto de notas si hay conflicto. No es un CRDT de edición de texto por carácter. |
| Persistencia | `src/biblioteca.ts`: adaptador único. Privadas en IndexedDB; compartidas en SQLite y réplica de cada cuenta en IndexedDB, con borrador pendiente. `device.ts`: almacenes boards/folders/assets/meta/history. Importación/exportación JSON conserva contenido e imágenes. |
| Historial | `BoardVersionHistory.tsx`, `history_api.py`: versiones manuales, automáticas y copia de seguridad al restaurar. El trigger conserva el JSON completo. |
| Usuarios y permisos | `AnonymousGate.tsx`, `anonymous_users.py`: cuentas con contraseña/emoji, invitaciones, propietario/editor/lector, comprobaciones HTTP y WebSocket, permisos sobre imágenes. Una privada del dispositivo no se envía al backend. |
| Matemática | `RightMathDock`, `GraphPlot`, `GraphFeatures`, `EquationSolvers`, `LinearSystems`: calculadora, ecuaciones, sistemas, gráficos insertables y **parámetros con deslizadores ya implementados**. Se amplían en fase 5; no se reemplaza el motor. |
| Tablas y archivos | `InlineTableEditor`, `StaticTable`, `formulas_excel.ts`, `excel_bridge.py`: tablas editables, fórmulas, importación/exportación. `App.tsx` importa imágenes, SVG convertido a PNG y páginas PDF. |
| Reconocimiento | `server.py`: escritura, letras entrenables, palabras, expresiones y calendario manuscrito. Hay opciones remotas que dependen de configuración/red. La inspección de código no prueba su precisión ni el lápiz físico Lenovo. |
| YouTube | `SyncedYouTubePlayer`: rango, reproducción sincronizada, objetos movibles y redimensionables. Los cursores quedan en una capa superior; dentro del iframe externo solo se conoce la última posición recibida fuera de él. |
| Organización | Biblioteca con carpetas, búsqueda, calendarios y eventos con recurrencia. No hay materias, tareas Kanban, favoritos, backlinks ni dashboard de estudio. |
| Aprendizaje, audio e IA | No hay tarjetas, modo examen, grabaciones sincronizadas ni asistente académico con proveedores intercambiables. El reconocimiento actual no equivale a ese asistente. |
| Rendimiento | `spatial_viewport.ts`: índice de trazos y descarte fuera de pantalla; cola de imágenes visibles; Plotly se carga aparte. `App.tsx` concentra demasiada lógica. Se extraen módulos pequeños de geometría, dibujo y UI; no se reescribe el componente. |
| Calidad | Vitest/fake-indexeddb, Playwright/Chrome y unittest/TestClient ya instalados. Cobertura actual de privadas, réplicas, conflictos, colaboración, cámaras y permisos. Faltan pruebas de las funciones nuevas y comprobación manual de stylus físico. |
| Repositorio y hosting | `.gitignore` excluye entornos, cachés, dist, datos, SQLite, secretos y logs. Vercel publica al hacer push a main; la PC expone API mediante túnel temporal. Para esta entrega **no se hace push, reinicio ni publicación**. La compilación de prueba usa `dist-fase1` para no sustituir la web que sirve el proceso actual. |

Riesgos principales: IDs duplicados al copiar, referencias rotas al duplicar diagramas,
selecciones basadas en índices de trazos, curvas seleccionables por un rectángulo
invisible, conflictos de texto, borrado del objeto de un conector y regresiones en
gestos o capas. Las pruebas de fase 1 se centran en estos casos además de conservar
las pruebas anteriores.

## Arquitectura completa prevista

Se conserva React/Vite/TypeScript, Canvas, FastAPI, SQLite e IndexedDB. Los módulos
nuevos se incorporan cuando llega su fase. No se instalan dependencias en fase 1.

### Componentes y modelos

1. **Organización visual:** `src/canvas/visualObjects.ts` define extensiones opcionales
   de ShapeItem, geometría de anclajes y conectores. `visualRendering.ts` dibuja en
   los Canvas existentes. `academicTemplates.ts` crea grupos de figuras y
   conectores con IDs nuevos. Controles e inspector pequeños en `src/components`.
   Una nota es una forma con texto/fondo; un conector es una flecha con extremos
   referenciados. Ambos permanecen en `content.shapes` para compartir selección,
   capas, snapshots, historial, copiado, guardado y recuperación offline.
2. **Marcos:** `Frame {id, title, bounds, background?, childRefs[], locked,
   presentationOrder}` en el JSON de pizarra. El movimiento aplica una operación
   a marco e hijos; presentación navega por centro y zoom de la cámara existente.
   Se reutiliza seguir cámara, sin forzar la cámara de quienes no siguen.
3. **Comentarios y grupo:** `CommentThread {id, boardId, anchorRef?|point,
   status, messages[{id, authorId, createdAt, text}]}`; autor asignado por FastAPI.
   Pomodoro guarda inicio/duración/estado con hora del servidor; reacciones son
   efímeras y acotadas; encuestas y votos tienen identidad y permisos. Usan el
   mismo socket y rutas de pizarra autorizadas, no otra infraestructura de presencia.
4. **Organización:** tablas SQLite por propietario para Subject, Task, Assessment,
   StudySession, Favorite y BoardLink. IndexedDB replica los datos que pertenecen
   al dispositivo. Dashboard opcional y vistas tabla/calendario/Kanban comparten
   tareas, sin duplicarlas. Un vínculo guarda `targetBoardId` y una etiqueta;
   `[[nombre]]` se resuelve al crearlo, no al navegar, para soportar renombrados.
   Backlinks/grafo consultan únicamente pizarras autorizadas.
5. **Aprendizaje:** `Flashcard {id, boardId, sourceRef, question, answer,
   difficulty, lastReview, nextReview}` y ReviewEvent. Algoritmo determinista y
   probado de intervalos. `ExamMask {id, bounds|objectRefs, hint, solved}` se dibuja
   sobre el original sin borrar contenido. Se amplían GraphFeatures/GraphPlot
   para ejercicios, reutilizando los parámetros ya disponibles.
6. **Imágenes:** editor con borrador local de la imagen, operaciones Canvas y
   aplicar/cancelar. Al aplicar se crea otro asset; el historial conserva el
   anterior. BackgroundRemovalProvider opcional en backend, con cola y límites,
   separado del event loop colaborativo. Antes de añadir rembg/ONNX se mide modelo,
   memoria y compatibilidad; sin proveedor se informa indisponibilidad. Sin API
   de pago obligatoria ni descarga de modelos al arrancar.
7. **Audio:** Recording y RecordingMarker ligados a usuario/pizarra; blobs
   protegidos, cuotas, consentimiento explícito y MediaRecorder iniciado solo
   por una acción. Marcas guardan instante y región/objetos. Reproducción y
   navegación no modifican los apuntes. No se graba audio de otros participantes.
8. **Asistente:** StudyAssistantProvider del lado servidor; configuración y claves
   fuera del frontend. Solicitudes contienen solo selección autorizada. Respuestas
   distinguen extractos y generación; nunca editan los originales automáticamente.
   La UI consulta disponibilidad y funciona normalmente sin proveedor.

### Operaciones y colaboración

- Fase 1 conserva el protocolo: PUT de snapshot con versión, notificación
  `board_version`, GET, fusión de tres vías y réplica local. **No añade sockets
  ni mensajes persistentes paralelos.** Nuevos objetos se sincronizan al confirmar
  el autoguardado, al igual que las figuras actuales; los trazos mantienen su
  avance efímero existente.
- Los conectores guardan tipo/ID estable del destino y posición relativa del
  anclaje, además de posiciones de respaldo. Su geometría se deriva de los objetos
  actuales; no se guardan nuevas versiones por cada cálculo de dibujo.
- Copiar un grupo remapea IDs de objetos, grupos y extremos internos. Un conector
  copiado sin su destino se pega libre, sin mover ni enganchar objetos originales.
- Eliminar un destino deja un extremo libre en su última posición. Deshacer
  recupera tanto contenido como referencia mediante el snapshot existente.
- La fusión combina propiedades independientes. Ediciones simultáneas distintas
  del texto de una nota conservan variantes visibles para resolverlas, en lugar de
  descartar silenciosamente una contribución. Las pruebas incluyen desconexión y
  HTTP 409. Edición simultánea del mismo valor geométrico sigue siendo optimista;
  un protocolo de operaciones/CRDT más fino se evalúa antes de trabajo intensivo
  con comentarios y texto multiusuario de la fase 3.
- Las fases que requieran nuevas operaciones persistentes usarán IDs idempotentes,
  versión base, permisos de servidor, acknowledgements y pruebas de reconexión.
  Se documentará ese cambio antes de implementarlo; no se da por hecho ahora.

### Migraciones, respaldo y reversión

- **Fase 1:** sin migración SQL ni cambio de versión IndexedDB. Solo campos
  opcionales en el JSON existente. Las pizarras anteriores siguen cargando con
  valores por defecto. Se conservan los tipos de figuras de respaldo para no
  destruir objetos si un cliente anterior guarda el documento.
- Fases 2 y 5 pueden añadir campos opcionales al JSON; su lector normaliza ausencias.
- Fases 3, 4, 7 y 8 pueden necesitar tablas: registro schema_migrations con número,
  migraciones transaccionales e idempotentes y claves foráneas por pizarra/usuario.
  Antes de ejecutarlas: copia SQLite con su API de backup, `PRAGMA integrity_check`,
  comparación de recuentos y un manifiesto de assets. No se copia solo el archivo
  principal de una SQLite activa con WAL.
- Reversión: detener escrituras, conservar la base nueva, verificar y restaurar
  el respaldo y la versión de aplicación compatible. No se borran tablas reales
  automáticamente para simular un rollback. Probar primero en una copia aislada.

## Secuencia y criterios de entrega

Cada fase termina en un punto de control local y se entrega con archivos,
migraciones, pruebas, problemas pendientes y pasos manuales. No se avanza a la
siguiente fase ni se publica automáticamente.

Para fase 1: notas con texto/color/escala/rotación; conectores rectos/curvos/en
ángulo, terminaciones y etiquetas; plantillas de árbol/grafos/lógica/flujo/estados/
matrices/vectores/circuitos/pseudocódigo. Todos seleccionables, agrupables,
duplicables, borrables, guardables, con deshacer y colaboración.

Validación: Vitest de geometría/remapeo/fusión y persistencia, unittest con datos
temporales y permisos owner/editor/viewer, Playwright de operaciones y dos
sesiones, build TypeScript/Vite y revisión de interfaz a escritorio/tablet.
No se afirma verificación física de Lenovo o precisión OCR sin probarla.

Comandos de entrega aislada:

```powershell
npm.cmd run build -- --outDir dist-fase1
$env:PIZARRA_TEST_PREVIEW = '1'
npm.cmd run test:browser
```

La salida aislada evita sustituir `dist` mientras el servidor público está activo.
La lista final de resultados se registra en `docs/FASE_1_ENTREGA.md`.
