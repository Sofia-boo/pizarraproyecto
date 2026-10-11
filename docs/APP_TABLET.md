# App para tablet

En el inicio y en el menú de perfil aparece **Descargar app para tablet**.
En Android/Chrome abre la instalación cuando el navegador la ofrece; si
todavía no está disponible, muestra los pasos desde el menú del navegador.
En iPad explica cómo agregarla desde Compartir en Safari. El icono abre
la pizarra como aplicación, con su propia ventana.

Las pizarras privadas siguen en IndexedDB, en el almacenamiento local
de ese dispositivo. **Abrir privadas y copias de este dispositivo** recuerda
el modo local para las próximas aperturas. Desde Perfil se puede volver a
ingresar al servidor. No cambia el formato ni migra o borra pizarras existentes.

La primera carga con internet prepara los archivos de la app para abrirla
sin conexión. También se guardan las herramientas de gráficos, PDF y la
impresión. Los datos y las imágenes de las pizarras se conservan en la base
local existente; el service worker no almacena respuestas de autenticación,
APIs ni ejecución de código. Las compartidas mantienen su copia local.
Para sincronizar con otras personas o ejecutar C++ hace falta conexión al
servidor. El respaldo e importación de Mis pizarras siguen disponibles.

Las actualizaciones de la app se preparan en segundo plano y se activan
al cerrar sus ventanas anteriores y volver a abrirla, sin recargar una
pizarra durante la escritura. La limpieza de cachés antiguas solo afecta
archivos de la aplicación, nunca la base de pizarras.

## Gestos

- Un dedo: desplazar la pizarra.
- Dos dedos: desplazar y pellizcar para ampliar o reducir.
- Lápiz: escribir. Mantenerlo quieto **3 segundos** abre las mismas acciones
  del clic derecho sobre el lienzo. Levantarlo antes permite un toque normal;
  moverlo empieza el trazo desde el punto original. El gesto no agrega un
  punto ni borra elementos al abrir el menú.
- Se conserva la recuperación de microcortes del lápiz y la separación de
  trazos al levantarlo durante un segundo.

Se quitaron del menú académico los grafos dirigido/no dirigido, máquina
de estados, puertas lógicas, componentes de circuitos y pseudocódigo que
estaban marcados. Los objetos de esos tipos que ya estaban guardados se
siguen mostrando y editando.

## Validación

39 pruebas de lógica y 24 pruebas de navegador aprobadas. Incluyen:
instalación y ayuda, apertura de una privada en una ventana nueva con internet
completamente deshabilitado, exclusión de APIs de la caché, pulsación del
lápiz durante 3 segundos sin trazo accidental, escritura/toques normales,
desplazamiento con un dedo y zoom con dos, recuperación de microcortes,
edición de elementos retirados del menú, colaboración, A4 y herramientas
de estudio. Compilación de producción aprobada.

Referencias: [instalación de una PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt),
[funcionamiento sin conexión con service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
