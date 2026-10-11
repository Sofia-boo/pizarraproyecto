# Entrega de fase 1: organización visual

Punto de partida: `37ca2c97`. Auditoría y arquitectura de las ocho fases:
[PLATAFORMA_ESTUDIO.md](PLATAFORMA_ESTUDIO.md).
Checkpoint en la rama local `fase1-organizacion-visual`, sin publicar.

## Funcionalidades implementadas

- Notas adhesivas con texto, seis colores, tamaño de letra, movimiento,
  escala y rotación. Inspector con Aplicar/Cancelar y aviso de versiones
  simultáneas del texto, que permite conservar ambas o resolverlas.
- Conectores rectos, curvos y en ángulo, con texto, color, grosor y estilos
  continuo/discontinuo/punteado. Cuatro terminaciones en cada extremo:
  ninguna, flecha, círculo y rombo. Anclajes por ID a figuras, notas, texto,
  trazos, imágenes, tablas, gráficos y videos. Los extremos siguen al destino
  al moverlo, escalarlo o girarlo; círculos, elipses y rombos usan su contorno.
  Al borrar un destino se conserva el extremo libre en su última posición.
- Biblioteca con búsqueda y 16 plantillas: árbol binario, grafos dirigido y no
  dirigido, flujo, estados, AND/OR/NOT/XOR, matriz, vector, resistencia,
  capacitor, fuente de tensión, tierra y pseudocódigo editable con monoespaciado.
- Integración con selección individual/múltiple, agrupación, capas, copia,
  pegado, borrado, deshacer/rehacer, zoom, autoguardado y colaboración existentes.
  Duplicar un diagrama remapea sus referencias internas y grupos; copiar un
  conector solo deja extremos libres. Los trazos copiados reciben IDs nuevos.
- Fusión de propiedades independientes y recuperación de cambios offline.
  Si dos personas escriben textos distintos sobre la misma nota, se conservan
  variantes visibles. FastAPI valida los objetos nuevos y mantiene permisos
  de propietario/editor/lector.
- UI clara/oscura y adaptación a escritorio, tablet y móvil. El inspector no
  queda tapado por el perfil; el botón móvil de edición evita el panel matemático.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `src/App.tsx` | Integración con herramientas, selección, transformaciones, persistencia, historial, copiado y borrado. Se conserva el componente existente. |
| `src/canvas/visualObjects.ts` | Tipos opcionales, geometría, anclajes, recorridos, hit testing, remapeo y fusión. |
| `src/canvas/visualRendering.ts` | Dibujo de notas, conectores y símbolos en los Canvas actuales. |
| `src/canvas/academicTemplates.ts` | 16 plantillas agrupadas con IDs y conexiones internas. |
| `src/components/VisualObjectInspector.tsx` | Editor de notas, conectores, etiquetas y conflictos de texto. |
| `src/components/AcademicLibrary.tsx` | Biblioteca buscable. |
| `src/components/visualTools.css` | Estilos, temas y adaptación de paneles. |
| `src/storage/merge.ts` | Fusión de propiedades de objetos visuales. |
| `reconocimiento_local/visual_objects.py` | Validación de geometría, texto, colores y anclajes nuevos. |
| `reconocimiento_local/server.py` | Validación antes de guardar el snapshot compartido. |
| `web_host.py` | Directorio frontend configurable mediante `PIZARRA_FRONTEND_DIR`; por defecto sigue usando `dist`. Permite revisar una compilación aislada. |
| `tests/visual-objects.test.ts` | Geometría, contornos, hit testing, transformaciones, eliminación, copia, plantillas y conflictos. |
| `tests/device-storage.test.ts` | Respaldo e historial de los nuevos objetos, además de las pruebas existentes. |
| `tests/test_backend.py` | API, roles, rechazo de objetos inválidos e historial. |
| `tests/browser/visual-objects.spec.mjs` | Operaciones de interfaz y dos sesiones con FastAPI/SQLite/WebSocket reales y base temporal. |
| `playwright.config.mjs`, `package.json` | Compilación aislada para pruebas y ejecución de los nuevos tests. |
| `.gitignore` | Excluye también `dist-fase1`; mantiene exclusiones de datos, secretos, entornos y temporales. |
| `docs/PLATAFORMA_ESTUDIO.md`, este archivo | Auditoría, arquitectura y checkpoint de entrega. |

## Persistencia y migraciones

Sin migraciones SQL ni IndexedDB. Sin dependencias nuevas. Se añaden campos
opcionales a `content.shapes`; se siguen leyendo pizarras antiguas, snapshots,
historiales y respaldos. Las figuras conservan un tipo geométrico de respaldo;
los clientes anteriores no tienen la representación especializada nueva.

Privadas: IndexedDB del mismo navegador/origen. Compartidas: SQLite del backend
y réplica local por cuenta/dispositivo. El protocolo continúa siendo PUT con
versión, aviso WebSocket y descarga/fusión. No hay sockets adicionales.

Las pruebas usan bases temporales. La revisión manual usa únicamente
`datos/revision-fase1`, una biblioteca separada de los datos actuales. No se
reinició el servidor público, no se sustituyó `dist`, no se hizo push ni deploy.

## Validación ejecutada

| Comando | Resultado |
| --- | --- |
| `npm.cmd run build -- --outDir dist-fase1` | TypeScript y Vite correctos. Salida aislada para conservar la web pública en ejecución. |
| `npm.cmd test` | 17 pruebas correctas: 8 de almacenamiento y 9 de objetos visuales. |
| `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v` | 3 pruebas de integración correctas, con SQLite temporal. |
| `$env:PIZARRA_TEST_PREVIEW='1'; npm.cmd run test:browser` | 5 pruebas correctas en Chrome: 3 regresiones anteriores y 2 de fase 1. |
| `npm.cmd run lint -- src/canvas src/components src/storage/merge.ts tests/visual-objects.test.ts tests/device-storage.test.ts tests/browser/visual-objects.spec.mjs` | Correcto en los módulos y tests indicados. |
| `git diff --check` | Sin errores de espacios. Git informa su conversión habitual LF/CRLF en Windows. |
| Revisión de `http://127.0.0.1:5178` | `/healthz` correcto; se creó/editó una nota desde Chrome en modo privado local, sin errores de JavaScript. |

Los casos de navegador verifican mover/redimensionar/girar notas, color, copiar,
agrupar/desagrupar, capas, deshacer/rehacer, recarga, referencias de árboles
duplicados y UI a 1366×900, 820×1180 y 390×844. Dos usuarios reales verifican
edición simultánea de texto, movimiento de un destino, conectores configurables,
duplicación de referencias y cambios offline que se reconcilian con un objeto
nuevo creado por otro participante. Los tests anteriores comprueban gestos de
rueda, seguimiento de cámara, cursores sobre widgets, privadas y réplicas.

Capturas reproducibles en `test-results/fase1-*.png` después de la suite de
navegador. No contienen pizarras reales y están excluidas de Git.

## Cómo probar manualmente

Vista local de revisión: **http://127.0.0.1:5178**. Su biblioteca compartida empieza
vacía; crear cuentas ahí no crea cuentas en el servidor público.

Para iniciarla de nuevo desde la raíz del proyecto, si ya no está en ejecución:

```powershell
npm.cmd run build -- --outDir dist-fase1
$env:PIZARRA_DATA_DIR = "$PWD/datos/revision-fase1"
$env:PIZARRA_FRONTEND_DIR = "$PWD/dist-fase1"
$env:PIZARRA_WS_ORIGIN = 'http://127.0.0.1:5178'
.venv/Scripts/python.exe -m uvicorn web_host:app --host 127.0.0.1 --port 5178
```

1. Crear una cuenta de revisión, o elegir «Abrir privadas y copias de este
   dispositivo». Cada puerto/origen tiene su propia IndexedDB; las privadas de
   Vercel no aparecen automáticamente en esta vista.
2. Pulsar el icono de nota o **N**, escribir, cambiar color y Aplicar. Con
   **V**, arrastrar; el tirador inferior derecho escala y el superior rota.
   Doble clic o «Editar nota» abre el inspector.
3. Insertar dos notas. Pulsar el icono de conector o **C** y arrastrar desde una
   hasta otra. «Editar conector» configura recorrido, puntas, estilo, color,
   grosor y etiqueta. Mover/girar un destino y comprobar la unión. Borrarlo y
   deshacer para comprobar la referencia.
4. Abrir el icono de libro y elegir un árbol/grafo/flujo/símbolo. Las plantillas
   llegan agrupadas: para cambiar un nodo, usar clic derecho → Desagrupar,
   seleccionarlo y editar su etiqueta. Copiar todo el diagrama y comprobar que
   las conexiones de la copia siguen a los nodos de la copia.
5. Usar Ctrl+C/V, Ctrl+G, clic derecho para capas, Supr y Ctrl+Z/Y. Recargar
   después del autoguardado; probar descargar/importar respaldo e historial.
6. Para colaboración, crear un enlace de edición desde Perfil → Compartir.
   Abrirlo en una ventana incógnita del **mismo origen local** y crear otra
   cuenta. Editar/borrar contenido de la otra persona y probar un lector.
   Editar el texto de una misma nota en ambas sesiones antes de Aplicar: ambas
   versiones deben poder revisarse en el inspector.
7. Probar modo oscuro, tamaño tablet, Ctrl+rueda, desplazamiento y lápiz físico.
   El test automático de tamaños no reemplaza la prueba en una Lenovo real.

## Límites y trabajo pendiente

- La colaboración no es un CRDT por carácter. Un cambio simultáneo al mismo
  campo geométrico se resuelve de forma optimista; el borrado local conserva la
  prioridad existente sobre una edición remota. Los textos de notas guardan
  variantes para revisión. El protocolo más fino queda previsto en la arquitectura.
- Matrices, circuitos y pseudocódigo son objetos visuales editables; esta fase
  no añade un simulador eléctrico ni otro motor algebraico.
- Vite mantiene la advertencia de bundles grandes (PDF/matemática/Plotly del
  proyecto). Python informa una deprecación existente de Starlette/httpx. No
  impiden compilación ni pruebas y no se cambiaron dependencias por estas advertencias.
- Pendiente comprobación manual del stylus físico/teclado virtual Lenovo,
  precisión OCR y medición con pizarras reales de gran tamaño. No se afirma
  haber probado esos dispositivos, modelos o cargas.
- La publicación pública queda pendiente de autorización del usuario.

## Siguiente checkpoint

**Fase 2: marcos y presentaciones**, según la arquitectura: contenido vinculado
por referencias, movimiento conjunto, bloqueo, orden de presentación y cámara
compartida reutilizando seguimiento. No se implementa ni se despliega en esta entrega.
