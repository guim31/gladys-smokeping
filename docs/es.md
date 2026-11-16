# SmokePing

[SmokePing](https://oss.oetiker.ch/smokeping/) mide la latencia y la pérdida
de paquetes de su conexión hacia objetivos elegidos, y dibuja sus famosos
gráficos de «humo». Esta integración lleva sus objetivos a Gladys: cada
objetivo se convierte en un dispositivo con su latencia mediana, sus
pérdidas, su jitter y su gráfico, las escenas reaccionan cuando un objetivo
se vuelve inaccesible o degradado, y un widget del panel los muestra todos.

Gladys lee SmokePing: no hace ping a sus objetivos por sí misma. Todo se queda
en su red (sin nube).

Probada con un SmokePing real en Docker (SmokePing 2.9.0, imagen
`lscr.io/linuxserver/smokeping`): objetivos accesibles, inaccesibles y con
pérdidas provocadas a propósito. Sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-smokeping/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- SmokePing 2.7 o posterior, con su interfaz web accesible desde Gladys.
- Una línea en la configuración de su servidor web, para que Gladys lea las
  mediciones (más abajo). SmokePing no tiene API: sus cifras solo están en sus
  archivos RRD.

## Primeros pasos

### 1. Servir los archivos RRD

SmokePing guarda un archivo RRD por objetivo en su carpeta `data`. Sirva esta
carpeta en solo lectura en `/smokeping-data/` del mismo servidor web.

**Imagen Docker `lscr.io/linuxserver/smokeping`**: cree el archivo
`site-confs/gladys.conf` en la carpeta montada en `/config` y reinicie el
contenedor:

```apache
Alias /smokeping-data /data
<Directory "/data">
    Options -Indexes
    Require all granted
</Directory>
```

**Paquete Debian o Ubuntu (Apache)**: las mismas líneas con
`/var/lib/smokeping` en lugar de `/data`, en
`/etc/apache2/conf-available/smokeping-data.conf`, después
`a2enconf smokeping-data` y recargue Apache.

**Nginx**: `location /smokeping-data/ { alias /var/lib/smokeping/; }`.

Compruébelo: `http://<su SmokePing>/smokeping-data/<Grupo>/<Objetivo>.rrd`
debe descargar un archivo. Estos archivos contienen las mismas cifras que la
página de SmokePing; restrínjalos como ella (`Require ip 192.168.1.0/24`, un
inicio de sesión) si es necesario.

### 2. Configurar la integración

En Gladys, abra la integración y rellene:

- **Dirección de SmokePing**: la dirección de su página web, por ejemplo
  `http://192.168.1.2/smokeping/`, o de su `smokeping.cgi`
  (`http://192.168.1.2/cgi-bin/smokeping.cgi` con el paquete Debian).
- **Dirección de los archivos RRD**: déjela vacía si siguió el paso 1.
- **Usuario** y **Contraseña**: solo si el servidor web pide un inicio de
  sesión.
- **Umbral de pérdida de paquetes** (10 % por defecto) y **Umbral de
  latencia** (100 ms): por encima, un objetivo está degradado.
- **Mediciones seguidas**: cuántas mediciones seguidas de SmokePing por
  encima de un umbral, o sin ninguna respuesta, antes de una alerta (2 por
  defecto). SmokePing mide cada 5 minutos por defecto: 2 son 10 minutos.
- **Intervalo de actualización**: de 1 a 5 minutos (1 minuto por defecto).
  Unas pocas peticiones pequeñas por objetivo cada vez.
- **Periodo del gráfico**: 3 horas, 30 horas o 10 días.
- **Idioma de los nombres**: idioma de los nombres de las funciones y de los
  resultados de escena (francés por defecto).

Después pulse **Probar la conexión**: lee SmokePing y cuenta los objetivos.

### 3. Añadir los objetivos

Abra la pestaña **Descubrir** de la integración: un dispositivo por objetivo
de SmokePing, con el nombre de su menú (los grupos no son dispositivos).
Añada los que desea seguir. Los disparadores de escena y el widget funcionan
para todos los objetivos, añadidos o no.

## Los dispositivos

Cada objetivo:

- **Accesible**: sí cuando al menos un ping respondió en la última medición,
  no tras el número elegido de mediciones sin ninguna respuesta.
- **Latencia mediana**: el tiempo de ida y vuelta mediano, en milisegundos.
- **Pérdida de paquetes**: la parte de pings perdidos, en porcentaje.
- **Jitter**: la desviación típica de los tiempos de ida y vuelta, en
  milisegundos.
- **Última medición**: cuándo midió SmokePing por última vez, en la zona
  horaria de Gladys.
- **Gráfico de SmokePing**: el gráfico de SmokePing del objetivo, como imagen
  de cámara, actualizado cada 5 minutos y a petición.

Las mediciones se envían como mucho cada 5 minutos, de inmediato cuando
cambia el estado. Un objetivo que SmokePing ya no mide muestra la insignia
inaccesible y no envía nada.

## Panel

El widget **SmokePing** muestra tres mosaicos (objetivos inaccesibles,
degradados, latencia mediana) y una fila por objetivo, primero los
inaccesibles y degradados, con su latencia y sus pérdidas. En sus ajustes,
elija un grupo, u objetivos añadidos a Gladys, y oculte los mosaicos o el
botón **Actualizar**. El botón **Actualizar** lee SmokePing de inmediato.

El widget **Cámara** del panel muestra el gráfico de un objetivo.

## Escenas

### Disparadores

- **Un objetivo se vuelve inaccesible**: se pierden todos los pings a un
  objetivo, tantas mediciones seguidas como se configuró. Variables: nombre
  del objetivo, grupo.
- **Un objetivo vuelve a ser accesible**: un objetivo inaccesible responde de
  nuevo. Variables: nombre del objetivo, grupo, duración del corte en
  minutos.
- **Pérdida de paquetes sobre el umbral**: la pérdida de un objetivo
  accesible alcanza el umbral, en mediciones seguidas. Variables: nombre del
  objetivo, grupo, pérdida de paquetes.
- **Latencia sobre el umbral**: la latencia mediana alcanza el umbral, en
  mediciones seguidas. Variables: nombre del objetivo, grupo, latencia
  mediana.

Todos pueden limitarse a algunos objetivos. No se envía ningún evento en la
primera lectura: solo cambios reales. Una alerta solo vuelve a dispararse
cuando el valor ha bajado del umbral. Un objetivo que se volvió inaccesible
mientras Gladys se reiniciaba se anuncia igualmente, una vez.

### Acciones

- **Estado de un objetivo**: accesible o no, estado en palabras, latencia
  mediana, pérdidas, jitter y una frase lista como «Box: Accesible, 23,4 ms,
  12 % de pérdidas, jitter 3,1 ms».
- **Contar los objetivos inaccesibles**: cuántos están inaccesibles,
  degradados y en total, en el servidor o en un grupo, y los nombres de los
  inaccesibles.

### Ideas de escenas

- **Un objetivo se vuelve inaccesible** (su router, 8.8.8.8) → un mensaje, o
  reiniciar el router con un enchufe inteligente.
- **Pérdida de paquetes sobre el umbral** → un mensaje con la pérdida, y
  después la acción «Enviar una imagen de cámara» con el gráfico de
  SmokePing.
- Cada mañana, **Contar los objetivos inaccesibles** → un mensaje si hay
  alguno.

Para vigilar equipos sin SmokePing, consulte
[gladys-ping-wol](https://github.com/guim31/gladys-ping-wol); para servicios
HTTP, [gladys-gatus](https://github.com/guim31/gladys-gatus).

## Solución de problemas

- **«SmokePing no responde»**: compruebe la dirección y el puerto desde la
  máquina de Gladys, y que ningún cortafuegos lo bloquee.
- **«Los archivos RRD no se sirven en la dirección de datos»**: falta el paso
  1, o la dirección de los archivos es otra: abra
  `…/smokeping-data/<Grupo>/<Objetivo>.rrd` en un navegador.
- **«No hay ninguna interfaz de SmokePing en esta dirección»**: introduzca la
  dirección de la página de SmokePing o de `smokeping.cgi`.
- **«La dirección redirige»**: introduzca la dirección completa de
  `smokeping.cgi`, con `https://` si el servidor redirige a ella.
- **«Archivo RRD no comprendido»**: los archivos vienen de una máquina que la
  integración no sabe leer (big-endian, o x86 de 32 bits); indíquelo en las
  issues.
- **Falta un objetivo**: debe estar en el menú de SmokePing (no oculto) y
  tener un archivo RRD; pulse Buscar en la pestaña Descubrir tras un cambio
  de la configuración de SmokePing.

## Límites

- Solo las mediciones del SmokePing maestro, no las de sus esclavos.
- Gladys lee la medición más reciente: un corte más corto que un paso de
  SmokePing puede pasar desapercibido, como en sus gráficos.
- Los objetivos con varios hosts (gráficos multi-host) no tienen archivo: no
  se proponen.
- El gráfico se envía como imagen PNG; Gladys lo muestra, un canal que solo
  acepta JPEG quizá no.
- Sin relación con SmokePing ni con sus autores.
