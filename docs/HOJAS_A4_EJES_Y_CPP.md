# Hojas A4, ejes y C++

## Uso

- **Elementos académicos → Agregar hoja A4** crea un fondo blanco con proporción
  210:297. Las hojas siguientes se colocan a la derecha, sin superponerse.
  Dibujar y colocar objetos dentro de sus límites define el área imprimible.
  Se seleccionan desde el borde o con selección múltiple. Mover una hoja mueve
  su fondo; para mover también los apuntes, seleccionarlos juntos.
- **Imprimir hojas A4 seleccionadas** prepara una página por hoja seleccionada.
  También existe **Imprimir todas las hojas A4** en Elementos académicos.
  La vista previa permite imprimir o guardar PDF con el diálogo del navegador.
  No se imprimen herramientas, selección, cámara ni cuadrícula del fondo.
  Se cargan imágenes y páginas PDF aunque estén fuera de la vista, se evalúan
  las fórmulas de tablas y se renderizan gráficos de Plotly para imprimir.
  Los videos se representan mediante su enlace; no se imprime un fotograma
  del reproductor externo. La salida usa imágenes a aproximadamente 150 dpi.
- **Formas → Ejes cartesianos X e Y cuadriculados** inserta un plano con 20
  divisiones por eje. Al redimensionar el objeto se agrandan también sus celdas.
- **Elementos académicos → Código C++ y consola** inserta un objeto persistente.
  El editor colorea C++, admite entrada por stdin y conserva código, salida y
  estado en la pizarra. El editor y la consola permanecen negros en los tres temas.
  Los resultados, errores de compilación y errores de ejecución vienen de Judge0;
  el backend de la pizarra nunca ejecuta ni compila el código del usuario.

## Judge0 en el servidor

El proxy requiere sesión y mismo origen. Acepta únicamente C++17, con límites
de 2 segundos de CPU, 5 segundos reales, 256 MiB, 16 procesos/hilos y red
deshabilitada. Permite hasta 5 envíos por usuario por minuto. Cada resultado
pertenece al usuario que lo envió; sus referencias expiran a los 15 minutos.
Los textos viajan en Base64 para conservar Unicode y las respuestas se acotan.

Configuración privada: `datos/judge0.json` con `url` y, opcionalmente, `token`.
También se admiten `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN` y `JUDGE0_RAPIDAPI_KEY`.
Estos datos nunca se entregan al frontend ni se guardan en el repositorio.

En esta PC Windows no había Docker ni WSL. Se instaló Microsoft WSL 2.7.13
y se habilitaron VirtualMachinePlatform/Windows Subsystem for Linux con
permisos de administrador. **Windows exige reiniciar antes de continuar**;
no se reinició automáticamente y Judge0 todavía no está operativo.
El estado real queda en `logs/instalacion-judge0.json` (ignorado por Git).

Después del reinicio, ejecutar como administrador:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar_judge0_windows.ps1
```

El instalador continúa con Ubuntu 22.04, configura esa distribución para
systemd/cgroup v1, instala Docker y Judge0 CE 1.13.1 en `/opt/pizarra-judge0`.
Genera contraseñas privadas para PostgreSQL y Redis, deshabilita la red de
los programas y publica la API solamente en `127.0.0.1:2358`.
Prueba una compilación y un bucle infinito antes de escribir la configuración
que habilita el proxy. Si Linux no ofrece cgroup v1, se detiene y lo informa;
no sustituye el aislamiento por un compilador local sin sandbox.
Al reiniciar Windows también habrá que iniciar nuevamente el backend/túnel
de la pizarra. La configuración de Judge0 se lee por solicitud.

Referencias: [instalación oficial de Judge0](https://github.com/judge0/judge0/blob/v1.13.1/CHANGELOG.md),
[API de Judge0](https://ce.judge0.com/),
[cgroups y systemd en WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

## Validación

Pruebas en almacenamiento temporal: guardado/validación de hojas, plano y
código; sesión/origen/propiedad del resultado; límites y protocolo del proxy
con Judge0 simulado. Navegador: PDF real de dos páginas A4, recorte y colores,
imagen/tabla/gráfico fuera de la vista, redimensionado de ejes, sintaxis,
consola y error del servicio conservando la salida anterior.
La ejecución real en Judge0 queda pendiente del reinicio y su instalación;
las pruebas del proxy con simulación no verifican el aislamiento del contenedor.

Validación previa a la publicación: 39 pruebas TypeScript, 10 de backend y
20 de navegador aprobadas. Compilación de producción aprobada; lint de los
componentes nuevos sin avisos. GraphPlot conserva los avisos de lint anteriores.
