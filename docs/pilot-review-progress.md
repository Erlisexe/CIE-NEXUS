# CIE Nexus: revisión técnica para piloto de Android v0.3.1

Fecha de cierre técnico: 2026-09-08. Base original recuperada: commit `87c78a1d7a4ebb50f83dd14b46d149c48ff7c7d0`, versión Sites 40 y Android 0.3.0. El código corregido se conserva en la rama `pilot-review-0.3.0`; la APK se generó desde `dc4fac7`. Se mantuvieron el proyecto Sites `appgprj_6a74ae9afea481918d0095af22adaf62`, Supabase CIE `qdjyfmibkzoexrurpyll`, el paquete Android `org.cie.nexus.mobile` y la arquitectura existente: Supabase para identidad, roles y asignaciones; D1 para los datos clínicos; SQLCipher local para borradores móviles. No se creó ni sustituyó ningún backend y no se modificó producción.

## Estado de los entregables

- APK original examinada: 48 434 832 bytes; SHA-256 `75adc3f27067a6cc3343658c3fceed10abafc4a6fdbf791bf7b7e439b88ee8be`; versión 0.3.0/código 3.
- APK corregida: 48 449 600 bytes; SHA-256 `1b11b15e97ea27a668d2155a8a18946cb2e13104d101bdb881cb829f4ce9779c`; versión 0.3.1/código 4; Android 7.0 o posterior; ARM64 y ARMv7.
- La APK 0.3.1 verifica con APK Signature Scheme v2, contiene SQLCipher y `allowBackup=false`. Conserva el mismo certificado de v0.3.0 para permitir actualización directa sin borrar los borradores locales.
- El certificado conservado es Android Debug, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Es una clave de desarrollo conocida y no es apropiada como firma definitiva de distribución.

## Verificación ejecutada

- Inspección de código, configuración Expo/Android, manifiesto, rutas web y API, modelo D1, migraciones y metadatos/RLS de Supabase en modo de sólo lectura.
- 60/60 pruebas automatizadas aprobadas. Cubren sesión multiprograma atómica, criterios y transiciones de targets, dominio único, gráfica acumulativa monotónica, idempotencia y concurrencia, permisos y asignaciones, registro ABC, reuniones, agenda, checklist, firma, borradores offline, recuperación de relojes y plantillas de nota.
- TypeScript estricto web y móvil aprobado; ESLint aprobado; build web/Worker aprobado.
- Build Android release aprobado y validación externa de la APK mediante ZIP CRC, `aapt` y `apksigner`.
- Comprobación pública previa en navegador de `/login` y `/formacion`. No se efectuó una prueba autenticada por rol porque no se proporcionaron cuentas de prueba. La repetición visual final local fue bloqueada por la política del navegador del entorno; el build final y el bundle sí fueron verificados.
- No hay dispositivo Android ni aceleración `/dev/kvm` disponibles en este entorno. Por ello no se pudo instalar ni ejecutar la APK en hardware/emulador real.

## Problemas corregidos

1. Una cita de otro día podía intentar cambiar la fecha clínica de una sesión móvil. La fecha ahora procede del inicio real en zona de Nicaragua y una cita incompatible se rechaza.
2. Un ABC de un programa sin resultados podía quedar enlazado a la sesión de otro programa. Ahora queda sin `program_session_id` cuando corresponde.
3. Se aceptaban fecha u hora ABC contradictorias con el evento. Ahora se valida su correspondencia temporal.
4. El cierre móvil no exigía evidencia completa de preparación ni firma. Se añadieron checklist previo, firma del profesional, validación en servidor y conservación dentro del snapshot, hash y auditoría, manteniendo la idempotencia de recibos antiguos.
5. Respuestas móviles atrasadas podían mezclar vistas de dos niños y una denegación podía dejar caché visible. Se añadieron guardas de selección e invalidación por denegación sin borrar borradores locales.
6. La revisión de un borrador cerrado por cambios de criterios podía reconfigurar evidencia histórica. Ahora conserva inicio, cierre, duración, ABC, observaciones y ensayos; impide mover datos a otro niño o convertir el tipo de medición; requiere una firma nueva para confirmar la revisión.
7. Las reuniones sólo comprobaban solapamientos antes de escribir, lo que dejaba una carrera concurrente. La migración aditiva `0022_meeting_booking_guards.sql` añade protección transaccional en base de datos contra cruces reunión–reunión y reunión–terapia para ambos participantes, y conserva una historia auditable de creación y estados. La API también valida destinatarios activos de Subdirección o Dirección Clínica, campos obligatorios, disponibilidad y cambios de estado optimistas.
8. Las etapas internas heredadas se mostraban con términos distintos a los requeridos. Sin migrar datos, la interfaz ahora presenta `baseline → acquisition → generalization → maintenance → closed` como **Línea base → Adquisición → Masterizado → Generalizado → Cerrado**.
9. Se corrigieron fallos de tipos y lint que impedían usar esas verificaciones como puertas de calidad.

## Resultados y conservación de datos

Las sesiones, programas, calendario, ABC y gráficas siguen usando una única evidencia clínica. Un encuentro puede cerrar varios programas dentro de una transacción y las sesiones resultantes se agrupan como una sola sesión clínica. La acumulativa parte de cero, suma cada target adquirido una sola vez y no puede descender. Sesiones y Gráficas permanecen dentro del expediente del niño y no forman parte del menú lateral principal.

Todas las migraciones preparadas son aditivas. Las pruebas comprueban que instalar las protecciones de reuniones conserva reservas previas y permite cancelar o cerrar incluso conflictos históricos. Ningún registro de producción fue leído como contenido, reescrito o eliminado durante esta revisión.

## Riesgos pendientes y dictamen

**Dictamen actual: NO APTA todavía para un piloto con datos reales de niños.** La candidata sí está preparada para una aceptación controlada con datos ficticios.

Faltan cuatro puertas antes del piloto real:

1. Publicar la versión backend preparada y aplicar la migración D1 0022. La APK apunta al backend existente; mientras producción siga en la versión 40, las nuevas validaciones del servidor y los bloqueos transaccionales de reuniones no estarán activos.
2. Resolver la firma Android. Para una transición inmediata de v0.3.0, esta APK conserva la clave de desarrollo. Una APK con clave de producción no podrá actualizar encima: primero hay que sincronizar todos los borradores pendientes, verificar sus recibos, desinstalar la versión anterior e instalar la firmada para producción.
3. Ejecutar aceptación en al menos un teléfono Android real: actualización 0.3.0→0.3.1, cierre firmado, modo avión, reinicio forzado, reintento idempotente, biometría/bloqueo y redes inestables.
4. Ejecutar el guion autenticado con cuentas de prueba de cada rol y alcance. También permanece desactivada en Supabase la protección contra contraseñas filtradas.

Después de superar esas puertas, el dictamen puede cambiar a **apta con condiciones** para 2–3 niños, con soporte cercano, copia de seguridad verificada y revisión diaria de sincronizaciones durante la primera semana.
