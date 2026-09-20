# Revisión de uso web — septiembre de 2026

Base inspeccionada: Site publicado v47, commit `dd88df7f05f8d21ac3a5dc51070229b46a0f926c`. GitHub era espejo de ese árbol. Este bloque se implementa sobre el código del Site.

## Fallos corregidos

- La lista de targets desbordaba la preparación de sesión y se superponía con los campos Niño, plantilla y fecha. El contenido ahora desplaza dentro del espacio disponible, con cierre y acciones accesibles.
- Los diálogos carecían de aislamiento del fondo, navegación de foco y cierre con Escape. Comparten una capa con foco contenido, restauración del foco y control de ventanas anidadas. La toma ocupa la pantalla completa.
- La firma estaba dentro de un `label` asociado al botón Limpiar deshabilitado. Se separaron esos elementos y se acotaron los estilos del SVG para que el icono no ocupe todo el recuadro.
- El cierre no explicaba sus requisitos pendientes. Ahora se muestran en un detalle desplegable, sin ocupar la zona de edición del teléfono. Los campos condicionales tienen nombres accesibles.
- Avisos quedaban debajo de la toma y el estado de guardado desaparecía en móvil. Los avisos se muestran sobre las ventanas y el guardado sigue visible.
- Ráfagas de datos generaban colas redundantes. El guardado conserva una petición activa y la instantánea completa más reciente; no elimina observaciones. El cierre espera a los guardados y reintenta el mismo contenido si se pierde su respuesta.
- Cargas sin límite de tiempo o respuestas antiguas podían bloquear o confundir expediente, calendario, sesiones, gráficas y ABC. Se acotaron solicitudes, cancelaron cargas obsoletas y añadieron errores con reintento.
- El callback de notificaciones cambiaba en cada render y disparaba cargas repetidas. Se estabilizó.
- Navegar por meses sumaba 30 días, lo que podía repetir o saltar meses. Ahora avanza por mes calendario.
- Los logs del Site mostraban peticiones de fuentes a rutas absolutas de la máquina de compilación. Las fuentes se sirven desde activos públicos locales.
- El menú móvil oculto seguía siendo alcanzable con teclado. Se corrigieron visibilidad, foco, Escape y estado expandido.

## Comprobación reproducible

`tests/ui/` contiene fixtures exclusivamente de desarrollo, con datos sintéticos y peticiones interceptadas en memoria. No se incorpora a las rutas o activos publicados. No se escribieron datos clínicos reales.

En navegador se comprobaron preparación/cierre, Escape/foco, ensayos y doble toque, deshacer, frecuencia con toques rápidos, duración, latencia, intervalo parcial, cadena de tareas, ABC, nota, Tomar/Hoja, firma manuscrita, respuesta de cierre perdida y reintento idéntico. El recorrido de teléfono se inspeccionó a 390 × 844; firma y cierre completo se validaron en escritorio. Se verificaron cambio de mes, apertura/cierre de programación y recuperación de carga de ABC.

Verificaciones del proyecto: TypeScript sin emisión, ESLint, build de Worker y `node --experimental-strip-types --test tests/*.test.mjs`. Las pruebas de cola y solicitudes están en `tests/client-interactions.test.mjs`; la suite existente cubre permisos y protección de evidencia, calendario y cierre clínico atómico.

## Límites de esta revisión

La revisión no equivale a una certificación WCAG. No se ejecutó un recorrido autenticado de cada rol con cuentas reales ni se probó hardware físico o lectores de pantalla. No se modificaron el backend clínico, el esquema D1, los datos, las transiciones de fase ni el APK. Las pruebas de red y cierre del navegador usan respuestas simuladas; las pruebas de persistencia usan SQLite en memoria.


## Acceso a la sesión desde el niño — continuación sobre Site v48

- Se añadieron «Iniciar sesión de hoy» en las tarjetas activas del directorio, la pestaña Sesiones del expediente y Próximas terapias del inicio. El calendario principal mantiene su gestión administrativa.
- Los accesos abren directamente la preparación y la toma reales. No cargan antes el catálogo general de programas, las plantillas y el calendario: la preparación resuelve todo en su API existente.
- El servidor usa la fecha de Nicaragua, la cita del profesional y el niño activo. Si hay varias citas, exige elegir y valida de nuevo. Canceladas, completadas, citas de otra fecha o de otro profesional no se ofrecen. Sin cita, el terapeuta recibe un mensaje; otros roles conservan exactamente el alcance previo para sesiones sin cita.
- Un borrador web se recupera con su mismo identificador y datos. El inicio evita el doble toque; cerrar la preparación devuelve el foco al acceso usado. Al terminar la toma, se refrescan el expediente y las citas del inicio.
- Botones táctiles de al menos 44 px y texto de 14 px; en teléfono las acciones del expediente se apilan. Las citas futuras muestran disponibilidad, sin un botón de inicio inmediato.

Validación de este bloque: 102/102 pruebas de proyecto, TypeScript, lint y build de Worker. Las cinco pruebas nuevas en `tests/web-session-collection.test.mjs` cubren resolución de cita, exclusiones, selección múltiple, reanudación con ensayos y permisos/alcance. No hay cambios de esquema ni migraciones.

Prueba visual reproducible: `node tests/ui/build-entry-harness.mjs` prepara `tests/ui/entry.html` y `entry-mobile.html` para el preview de desarrollo. Renderiza los componentes reales con datos y respuestas sintéticos; el adaptador de prueba incluye únicamente la función real de etiquetas de roles, sin cargar autenticación del servidor. El bundle generado se ignora y no se publica. Se comprobó cada acceso, elección de segunda cita, reanudación sin POST de inicio, doble toque con un solo POST, ausencia de cita, fallo de carga/reintento, consulta sin botón de registro, Escape/restauración de foco, preparación/toma y regreso al expediente a 390 × 844. No es una prueba autenticada con cuentas reales ni con hardware físico.

## Filtros clínicos coherentes — continuación sobre Site v49

Se inspeccionaron la fuente publicada del Site y sus tablas actuales de perfiles/citas mediante consultas de lectura. El conjunto actual no reproduce exactamente las citas mencionadas en el reporte del usuario. Sí se confirmó el defecto: el calendario no recibía sede/niño del encabezado, su API ignoraba esos filtros y el panel compacto añadía un alcance por profesional y una ventana de fechas diferentes. El PR 1 conservaba el mismo árbol que v49; esta corrección se hizo primero sobre el Site.

- El filtro combina sede actual del niño **y** niño seleccionado. Reduce el alcance autorizado del usuario; no sustituye permisos ni cambia asignaciones. «Todas» significa todo lo que ya puede consultar esa cuenta.
- Se muestra una banda con Sede, Niño, nombres accesibles explícitos, indicador «Mostrando» y «Limpiar filtro» siempre visible. Al cambiar de sede se limpia una selección de niño incompatible.
- Calendario e Inicio comparten próximas terapias de hoy a los siguientes 30 días, según la fecha de Nicaragua. Navegar por el mes no altera esa lista. Se muestran hasta ocho y, si hay más, se indica «8 de N». El terapeuta mantiene su límite de citas propias en el servidor; otros roles conservan su alcance previo.
- `/api/calendar` acepta los parámetros opcionales `site`, `profileId` y `upcoming=1`. La respuesta conserva `appointments` para el periodo solicitado y añade `upcomingAppointments`/`upcomingPeriod` cuando se solicitan. Las consultas intersectan permisos y filtros antes de obtener las citas. Se evita consultar el perfil por cada cita y repetir el catálogo de profesionales.
- Programar/editar ofrece únicamente niños dentro del filtro y profesionales elegibles. El formulario envía `viewFilter`, que se valida de nuevo en el servidor. Los clientes anteriores que no lo envían mantienen su contrato y sus controles de permisos. Cambiar el filtro cierra una gestión administrativa abierta; las respuestas obsoletas se ignoran y no se muestran citas anteriores durante la carga.
- Directorio, contadores del inicio, programas, sesiones, evaluaciones, gráficas e informes reciben el mismo alcance clínico. El selector de sede del directorio comparte el estado global. Se conserva la lista completa de perfiles para actualizar sus datos sin perder otros registros del estado.

Verificación: **107/107 pruebas**, TypeScript, ESLint y build de Worker aprobados. Las cinco pruebas de `tests/clinical-filter.test.mjs` cubren intersección en cinco sedes, monotonía al reducir filtros, alcance de roles, niño desconocido, periodo fijo y validación del filtro enviado. La suite existente sigue validando evidencia clínica, cancelación/restauración, conflictos, cierre y transiciones.

Navegador con componentes reales y datos sintéticos (`tests/ui/entry.html?scope`): seis citas sin filtro → dos de Estelí → una del niño; limpiar restaura seis; Inicio y Calendario coinciden; la programación ofrece/envía sólo el niño seleccionado; el directorio comparte la sede; cambiar rápidamente de Estelí a León ignora la respuesta tardía; navegar al mes siguiente conserva próximas terapias. En `scope-mobile.html` (390 × 844), los selectores y limpiar miden 44 px de alto, el documento no desborda horizontalmente y el formulario abre/cierra con opciones coherentes.

No se escribieron datos reales ni se cambiaron esquema D1, autenticación, asignaciones, reglas clínicas o APK. La validación de navegador usa respuestas en memoria; falta aceptación autenticada con cuentas reales por rol y teléfono físico. No se declara certificación de accesibilidad.

## Sesiones = encuentros cerrados — continuación sobre Site v50

La lectura del Site confirmó cinco filas cerradas en `intervention_sessions`, vinculadas a cuatro identificadores de encuentro. Inicio, directorio y expediente contaban las filas por programa, mientras el historial completo ya agrupaba encuentros.

- `summarizeClosedSessions` comparte la definición entre servidor y vistas: sólo registros cerrados, agrupados por `clinicalSessionRunId`. Los registros antiguos sin ese vínculo cuentan individualmente; no se fusionan por fecha, nombre ni profesional.
- `sessionCount` en la API de perfiles ahora cuenta encuentros cerrados y se añade `programRecordCount`. Inicio utiliza esos totales completos, sin el límite de la lista reciente. Su actividad reciente muestra un elemento por encuentro.
- La tarjeta del niño y el resumen del expediente muestran encuentros. La pestaña Sesiones presenta una entrada por encuentro y permite desplegar sus registros por programa, conservando nombres y notas. Expediente e historial distinguen explícitamente ambos totales.
- Los programas archivados siguen aportando sus encuentros al historial. Borradores, citas programadas, canceladas y sesiones en curso no incrementan el contador de encuentros cerrados. Los listados por programa usan la etiqueta «registros por programa».

Validación: **111/111 pruebas aprobadas**, TypeScript, ESLint y build del Worker. Las cuatro regresiones nuevas cubren 5 registros → 4 encuentros, estados no cerrados, identidades diferentes en una misma fecha y un historial mayor de 500 registros que incluye programas archivados. Se comprobó en navegador la tarjeta, el resumen, las cuatro entradas del expediente y del historial completo, y la expansión de Comunicación funcional/Social con notas conservadas usando datos ficticios (`entry.html?encounters`, `encounters-mobile.html`). En teléfono de 390 × 844, sin desbordamiento horizontal; contador de 14 px y control desplegable de 45 px, operable por teclado.

Esta corrección cambia conteos y presentación, sin escribir datos clínicos, modificar cierres, permisos, esquema, gráficas o APK. No se recorrió el sistema publicado con cuentas reales por rol; el navegador usa las interfaces reales con respuestas sintéticas.
