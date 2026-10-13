# Asistente de estudio en la PC y la tablet

La pizarra incorpora **IA → Asistente de estudio local**, enfocado en matemática, bases de datos y programación. Se ejecuta dentro del navegador, en un worker separado del dibujo, y puede recibir texto, imágenes del dispositivo y selecciones de manuscritos o imágenes de la pizarra. Las respuestas se pueden insertar como texto editable.

## Preparación

1. Abrí la app con conexión y esperá a que termine de prepararse para funcionar sin internet.
2. Entrá a **IA → Asistente de estudio local → Descargar IA para este dispositivo**.
3. La descarga inicial es de aproximadamente **890 MB**. Conservá al menos 1,2 GB de espacio disponible y esperá la confirmación de modelo descargado.
4. Repetí la descarga en cada dispositivo. Se almacena por navegador y dominio; descargarlo en la PC no lo instala en la tablet.
5. Al volver a abrir el asistente, elegí **Cargar IA guardada**. Esto también funciona sin conexión. Cerrar el asistente libera la memoria del modelo.

En Android conviene usar Chrome actualizado y cerrar otras aplicaciones para liberar memoria. Se usa CPU para permitir funcionar sin WebGPU, incluida la Lenovo Tab M11. La compatibilidad y velocidad en esa tablet requieren una prueba en el equipo real; las pruebas de escritorio no garantizan el rendimiento móvil.

## Alcance y limitaciones

- Se elige Matemática, Bases de datos o Programación. Antes de responder, una clasificación local comprueba si la consulta corresponde a esas materias; cuando no la reconoce como académica, devuelve un aviso de alcance. Las instrucciones también enfocan la respuesta en esas materias. Es una configuración sobre modelos generales, no un entrenamiento exclusivo ni una garantía absoluta de clasificación correcta.
- Se usan modelos pequeños para limitar memoria y descarga. Pueden cometer errores de cálculo, transcripción, interpretación de gráficos y programación; no sustituyen la verificación de resultados.
- La lectura de imágenes y manuscritos es aproximada. Es mejor adjuntar un ejercicio por imagen, legible y recortado. No usa la API de Datalab.
- El contexto y la longitud de las respuestas son limitados para controlar el consumo de memoria. Se conserva la imagen más reciente del contexto, de modo que se pueden hacer preguntas posteriores sobre ella.
- Las imágenes se reducen antes de procesarlas. El chat y sus imágenes quedan en IndexedDB, separados por cuenta y pizarra. No se comparten automáticamente con otros participantes.
- No se ejecutan código ni consultas SQL generados por el asistente. La herramienta existente de compilación C++ sigue usando Judge0 y requiere conexión.
- El cálculo del modelo puede ser lento, especialmente en CPU móvil. Se puede detener la respuesta o cancelar la preparación. No se inicia una descarga de modelos automáticamente al abrir la pizarra.

## Implementación

Se usa Transformers.js 4.3.1 con ONNX Runtime WASM de un solo hilo. El runtime y el worker se incluyen en la caché versionada de la app; los pesos se guardan en una caché independiente, que las actualizaciones de la pizarra conservan.

- Texto: [Qwen3-0.6B ONNX](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX), revisión `58ca03a5e7b354b480b1a82b34bde8dc7b854cc0`, cuantización de 8 bits para CPU.
- Lectura visual: [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct), revisión `7e3e67edbbed1bf9888184d9df282b700a323964`, cuantización de 8 bits. Se pasa su descripción al modelo de texto, indicando que puede contener errores.
- Motor: [Transformers.js](https://huggingface.co/docs/transformers.js/).

La red se utiliza para descargar los archivos públicos del modelo durante la preparación. Las preguntas y las imágenes se procesan localmente. La carga offline exige que estén presentes todos los archivos requeridos de ambos modelos; una descarga incompleta no se presenta como lista.

Las pruebas unitarias se ejecutan con `npm test`. `tests/browser/local-assistant.spec.mjs` verifica la interfaz con un motor simulado. Para probar inferencia real, primero compilá y ejecutá el preview de producción en el puerto 4173, y luego ejecutá `node scripts/verify-local-assistant.mjs`. Esta prueba usa un perfil separado en `logs/ia-prueba-browser`, descarga los modelos en su primera ejecución y comprueba texto, imagen, SQL, programación, rechazo de una receta y recarga con la red completamente desactivada.

**Quitar modelo de este dispositivo** borra únicamente la caché del asistente. No borra pizarras, respaldos, el historial del chat ni los ejemplos enseñados al reconocedor local del servidor. **Vaciar esta conversación** afecta únicamente el chat de la cuenta y pizarra actuales.
