# Vercel + tu computadora + copias en cada dispositivo

La página permanece en **https://pizarraproyecto.vercel.app**. No requiere Render.

- **Privadas:** se crean y guardan en IndexedDB, en el navegador del usuario.
  No se envían al servidor. Se abren con «Abrir privadas y copias de este dispositivo».
- **Compartidas:** la copia principal se guarda en `datos/pizarras.db` de tu PC.
  Al abrir una, se descarga su contenido e imágenes al navegador de ese usuario.
  Al guardar o recibir una versión nueva, también se actualiza esa copia local.
- **Servidor apagado:** se pueden abrir las privadas y las compartidas descargadas.
  Los cambios en compartidas quedan pendientes localmente. Al reconectar se usa
  la versión original para evitar reemplazar cambios ajenos. Si hay conflicto,
  «Guardar copia como privada» permite conservar una versión independiente.

Una copia local no convierte las computadoras de los usuarios en servidores:
otros participantes siguen necesitando tu PC conectada para colaborar y sincronizar.
Cada copia pertenece a ese navegador y dominio. No se guarda automáticamente en
una carpeta visible del explorador de archivos. «Descargar respaldo» exporta un
archivo JSON con contenido e imágenes; «Importar respaldo» lo abre como privada.
No se pueden retirar copias que otro usuario ya descargó.

## Primera conexión con Vercel

1. Desde PowerShell, en esta carpeta, ejecutá:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\conectar_pc_vercel.ps1
   ```

2. El script compila, inicia Python y un túnel HTTPS temporal de Cloudflare,
   y genera `vercel.json`. Los procesos quedan en segundo plano; sus logs están
   en `logs/`. Si el puerto 8765 está ocupado, cerrá el servidor anterior primero.
3. Subí los cambios y `vercel.json` a GitHub. Vercel publica desde `main`.
4. Abrí el enlace de Vercel. Las privadas funcionan sin iniciar sesión.
   Para crear o editar compartidas, ingresá o creá una cuenta.
5. En Mis pizarras elegí «Privada en este dispositivo» o «Compartida en el servidor
   + copia local». «Publicar copia compartida» conserva la privada original.
   Después, desde Perfil, creá la invitación para otros participantes.

La conexión temporal cambia al reiniciar el túnel: hay que regenerar y subir
`vercel.json`. Para usar una dirección fija, configurá un túnel con hostname
estable en Cloudflare y ejecutá:

```powershell
node scripts/conectar-vercel.mjs https://TU-HOSTNAME-FIJO
```

Reiniciá `iniciar_pizarra.ps1` para cargar `hosting.local.json` y subí el
`vercel.json` generado. La página sigue alojada en Vercel: solo `/api/` y
`/recognize/` se reenvían a tu PC. La conexión en vivo usa tickets de un solo uso
para acceder al túnel sin compartir cookies entre dominios.

## Apagar la conexión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\detener_pc_vercel.ps1
```

Tu PC debe estar encendida y conectada mientras haya colaboración. Apagarla
no borra `datos/` ni las copias descargadas en los navegadores.

## Datos anteriores

No se borran ni se publican `datos/pizarras.db`, usuarios o contraseñas.
Las pizarras existentes en el servidor se mantienen allí; las nuevas son privadas
locales por defecto. Las versiones antiguas que usaban IndexedDB se recuperan
una sola vez como «Pizarra local recuperada», si existen en ese navegador y dominio.
No se pueden leer automáticamente los datos guardados bajo otro dominio o puerto.

El navegador puede borrar datos si el usuario limpia el sitio o bajo presión de
almacenamiento. Se solicita almacenamiento persistente, pero conviene descargar
respaldos. Cambiar de navegador, dominio o dispositivo no traslada las privadas.

## Verificación

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm.cmd run build
npm.cmd run test:browser
```

Las pruebas de navegador usan Chrome instalado. Las pruebas Python usan una
base temporal; no modifican las pizarras reales.

Documentación: https://vercel.com/docs/routing/rewrites y
https://developers.cloudflare.com/tunnel/get-started/
