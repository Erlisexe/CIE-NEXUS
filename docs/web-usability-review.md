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
