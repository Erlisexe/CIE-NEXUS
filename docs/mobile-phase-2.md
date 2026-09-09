# Recolección móvil — Fase 2

## Flujo

Agenda / niño → preparar con conexión → sesión única → programas y targets → nota y ABC → cierre local → cola → confirmación del servidor.

La preparación no crea una sesión clínica ni bloquea la cita. Se guarda cifrada por cuenta y puede abrirse sin conexión. El cierre vuelve a verificar los permisos y la configuración vigente. Las respuestas y el historial de correcciones se conservan en `clinical_session_runs.collection_snapshot`; los resultados evaluados siguen en `intervention_sessions`.

## API

- `GET /api/mobile/v1/collection?profileId=...&appointmentId=...`: preparación de una cita propia. El terapeuta necesita cita; otros profesionales pueden registrar sin cita sólo niños asignados directamente.
- `POST /api/mobile/v1/collection`: cierre idempotente con el mismo UUID y contenido en cada reintento. Exige bearer token verificado, campos de nota obligatorios y oportunidades válidas. Límite de transporte: 2 MB; nunca se recorta la cantidad de ensayos al alcanzar un mínimo clínico.
- El recibo contiene `id`, `status: closed`, `closedAt`, `sessionIds` y `duplicate`.
- `401`: reautenticación; `403`: permiso o asignación; `409`: conflicto que requiere revisión; `503`: no se confirmó el lote y debe reintentarse conservando el contenido.

Se contrastan snapshots dentro de la transacción para detectar cambios concurrentes. `batch` de D1 revierte todo si falla una sentencia. La restricción única por cita y el ID del encuentro impiden duplicados. El hash evita reutilizar el ID con otros datos. La comparación y el guardado de la nota usan la plantilla vigente del servidor; nunca se confía en campos obligatorios enviados por el cliente.

Una sesión offline anterior puede modificar la fecha de dominio. Antes de aplicar ese cambio se exige confirmación explícita y se guarda una auditoría del impacto. El motor de dominio sigue siendo único y los eventos se mantienen únicos por target.

## Límites operativos

- Preparar cada cita con conexión antes de salir. Un expediente no consultado o una cita no preparada no está disponible offline.
- Inicio de sesión y reautenticación necesitan internet. Los borradores permanecen protegidos por cuenta si expira el acceso.
- Sincronización automática sólo mientras la app está abierta o al volver a ella.
- Una sesión cerrada pendiente conserva un envío inmutable mientras el resultado es incierto. No se modifica ni se descarta para solucionar una falla de red.
- Configuración o plantilla cambiadas permiten revisión explícita. Mediciones retiradas, cambio de unidad, cancelación o reasignación requieren revisión clínica/administrativa y no transforman datos automáticamente.
- No se añadieron pagos, tiendas, notificaciones, firma legal ni carga de fotos/videos.

## Referencias de interacción

- https://help.hirasmus.com/knowledge/running-a-session
- https://help.hirasmus.com/knowledge/offline-mode-on-hi-rasmus
- https://help.hirasmus.com/knowledge/hi-rasmus-101-collecting-data-and-writing-session-notes-in-hi-rasmus

## Verificación

Las pruebas usan bases SQLite en memoria. Incluyen cierre multiprograma, rollback, reenvíos, concurrencia, muestras insuficientes, 12 ensayos, permisos, plantilla, datos alterados, recuperación y recálculo histórico. Ninguna prueba crea expedientes o sesiones en producción.
