# Avisos de terceros del instalador Windows 11

- **Node.js 24 LTS** se distribuye bajo su licencia incluida en `runtime/node/LICENSE-NODE.txt`. El archivo binario se descarga desde `nodejs.org` y su SHA-256 se compara con `SHASUMS256.txt` oficial durante la compilación.
- **win-acme** se incluye para solicitar y renovar certificados TLS de Let's Encrypt. Conserva sus propios avisos y archivos de licencia dentro de `tools/win-acme`.
- **NSIS 3.12** genera el ejecutable instalador bajo la licencia zlib/libpng, que permite uso comercial. NSIS no se instala en los equipos donde se despliega SAS.

El instalador SAS no incorpora secretos, bases de datos ni certificados privados del entorno donde se compila.
