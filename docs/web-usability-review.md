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
