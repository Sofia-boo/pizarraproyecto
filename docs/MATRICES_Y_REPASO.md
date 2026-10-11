# Matrices y tarjetas de estudio

Entrega del 11 de octubre de 2026. Se amplía la aplicación existente sobre el
checkpoint `ce9cd9e7`, sin publicar ni sustituir el frontend público.

## Matrices del lienzo

El vector y la matriz académicos ahora tienen una grilla de celdas. Seleccionar
el objeto → **Editar elemento** (o doble clic) permite cambiar filas/columnas
entre 1 y 12 y escribir cada celda. Una columna se representa como vector; varias
como matriz. Se conservan las celdas al ampliar dimensiones y las nuevas empiezan
en cero. Reducir dimensiones quita las celdas de las filas/columnas eliminadas;
se puede cancelar antes de Aplicar o deshacer después.

Los vectores antiguos con etiquetas `x\ny\nz` se leen sin migrar la pizarra.
Copiar, girar, escalar, agrupar, capas, borrar, deshacer, historial, respaldo y
colaboración continúan usando el sistema existente. Las ediciones concurrentes
en celdas diferentes se combinan; la misma celda sigue la resolución optimista.

## Calculadora

Abrir el icono de calculadora. **MENU** permite entrar a Cálculo, Raíces,
Sistemas, Matrices y Cálculo de matrices. Se conservan los modos anteriores.

En **Matrices**, elegir **MatA–MatE**, dimensiones de 1×1 hasta 4×4 y valores.
Se admiten números, coma decimal, fracciones y expresiones numéricas simples
como `(1+2)/4`. **Guardar MatX** confirma la memoria personal.

Para copiar del lienzo: seleccionar una única matriz/vector con V, entrar a
Matrices, elegir la memoria destino y pulsar **Usar selección en MatX**. Se guarda
una copia; calcular no modifica los apuntes. Las letras simbólicas x/y/z deben
reemplazarse por números para calcular. Objetos mayores de 4×4 siguen siendo
válidos en el lienzo y muestran un error claro al intentar importarlos a la calculadora.

En **Cálculo de matrices** se usan las memorias guardadas:

| Operación | Ejemplo |
| --- | --- |
| Suma / resta | `A+B`, `A-B` |
| Producto matricial | `A*B` |
| Determinante | `det(A)` |
| Transpuesta | `transpose(A)` o `tr(A)` |
| Inversa | `inv(A)` o `A^(-1)` |
| Escala / expresiones compuestas | `2*A`, `inv(A)*B`, `(A+B)*C` |
| Último resultado | `Ans` |

Se puede guardar un resultado matricial en otra memoria o insertarlo como un
objeto editable en la pizarra. Se comprueban dimensiones, memorias vacías,
división por cero, matrices singulares y resultados no finitos. La evaluación
usa una gramática restringida, sin eval, asignaciones ni funciones arbitrarias.
El cálculo es numérico en punto flotante, con presentación de 12 cifras
significativas; no es un motor simbólico de fracciones exactas. La inversa
rechaza también matrices numéricamente inestables.

## Tarjetas y repetición espaciada

El tercer icono del panel lateral abre **Tarjetas de estudio**.

- Crear tarjetas con pregunta, respuesta y mazo. **Usar selección como respuesta**
  copia texto/notas/matrices o solicita reconocimiento de los trazos seleccionados
  al motor existente. No modifica el original. Las tarjetas también pueden ser manuales.
- Repasar únicamente las pendientes: primero pregunta, después **Mostrar respuesta**.
- Calificar con Otra vez, Difícil, Bien o Fácil. La pantalla muestra el intervalo
  antes de elegir. Se guardan última revisión, próxima fecha, factor de dificultad,
  intervalo y todo el historial de calificaciones.
- Editar pregunta/respuesta o mazo conserva el progreso. Se pueden consultar el
  historial y las fechas, filtrar por mazo o eliminar tarjetas.
- Descargar/importar **Respaldo de estudio**, que incluye tarjetas, progreso y
  memorias A–E. Se valida todo antes de importar; los registros ya presentes se
  conservan para evitar reemplazar un progreso más reciente.

Es un planificador sencillo inspirado en aplicaciones de tarjetas, no el
algoritmo de Anki ni compatibilidad con archivos `.apkg`. Otra vez programa
1 minuto; el primer Bien, 1 día; el primer Fácil, 4 días. Los siguientes intervalos
dependen del factor y se limitan a 365 días. El reloj de revisión se actualiza
durante el uso y al reabrir el panel.

## Datos, compatibilidad y archivos

Las matrices del lienzo añaden `matrix: string[][]` opcional a las figuras y
mantienen una etiqueta de respaldo. FastAPI valida filas rectangulares, tamaños
y longitudes. No hay migraciones SQL ni IndexedDB, ni dependencias nuevas.

Tarjetas, historial personal y memorias se guardan en el almacén `meta` de la
IndexedDB existente, bajo claves por cuenta. En modo dispositivo sin cuenta se
usa el ámbito del dispositivo. Las escrituras comprueban revisión dentro de una
transacción; una pestaña antigua no puede reemplazar silenciosamente otra edición.
Estos datos personales no se suben al servidor ni se comparten con participantes;
el respaldo permite llevarlos a otro navegador/dispositivo. Cada origen tiene su
almacenamiento: localhost y Vercel no comparten automáticamente las memorias.

Archivos principales:

- `src/study/matrices.ts`: datos de matrices, compatibilidad y cálculo.
- `src/study/flashcards.ts`, `personalStore.ts`, `backup.ts`: planificación,
  registros personales con revisión y respaldo.
- `src/components/MatrixGrid.tsx`, `MatrixCalculator.tsx`, `FlashcardPanel.tsx`,
  `studyTools.css`: grillas, calculadora y repaso con temas y adaptación móvil.
- `src/App.tsx`, `RightMathDock.tsx`, `biblioteca.ts`: selección, inserción, menú
  existente y ámbito de cuenta.
- `src/canvas/visualObjects.ts`, `visualRendering.ts`, `academicTemplates.ts`,
  `src/components/VisualObjectInspector.tsx`: dibujo, celdas, plantillas y fusión.
- `reconocimiento_local/visual_objects.py`: validación de matrices compartidas.
- `tests/study-tools.test.ts`, `tests/device-storage.test.ts`, `tests/test_backend.py`,
  `tests/browser/study-tools.spec.mjs`, `tests/browser/visual-objects.spec.mjs`:
  pruebas nuevas y ampliadas. `package.json` incorpora el archivo de pruebas.

## Validación

- `npm.cmd run build -- --outDir dist-fase1`: TypeScript/Vite correctos. Se usa
  salida aislada para conservar `dist` servido por el proceso público.
- `npm.cmd test`: 27 pruebas correctas, incluidas operaciones, pivoteo, 4×4,
  errores, compatibilidad, fusión de celdas, planificación, cuentas, revisiones
  obsoletas y respaldo que conserva el progreso.
- `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v`:
  4 pruebas correctas con datos temporales: permisos, persistencia, WebSockets,
  historial y validación de matrices nuevas/vectores antiguos.
- `$env:PIZARRA_TEST_PREVIEW='1'; npm.cmd run test:browser`: 7 pruebas correctas,
  con las regresiones anteriores, cinco memorias, matrices 4×4, selección→memoria,
  cálculo→lienzo, recarga, tarjetas→repaso→respaldo y dos colaboradores reales.
- Oxlint en los nuevos módulos/paneles/tests y `RightMathDock.tsx`: correcto.
- Las capturas quedan en `test-results/calculadora-matrices.png`,
  `matrices-movil.png` y `tarjetas-movil.png`, excluidas de Git.

Continúan las advertencias anteriores de bundles grandes y Starlette/httpx.
No se comprobó un lápiz físico Lenovo ni se hizo una prueba de carga masiva.

## Revisión local y próximo paso

**http://127.0.0.1:5178**, con la biblioteca de revisión en
`datos/revision-fase1`, separada de las pizarras actuales. Recargar la página para
obtener el frontend nuevo. El servidor público de 8765 y Vercel no se actualizaron.

La publicación requiere autorización. Marcos/presentaciones y las demás
herramientas del plan permanecen pendientes; esta entrega implementa el pedido
concreto de matrices y tarjetas sin dar por terminada toda la fase de aprendizaje.
