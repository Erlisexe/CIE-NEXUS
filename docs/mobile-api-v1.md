# CIE Nexus Mobile API v1

## Alcance de la fase 1

Esta API constituye la frontera segura entre la futura aplicación móvil y CIE Nexus. La aplicación móvil no se conecta directamente a Cloudflare D1 y nunca recibe credenciales privilegiadas. En esta fase los endpoints son de lectura; el cierre y la sincronización idempotente de sesiones se incorporarán con la fase de recolección móvil.

Base de ruta: `/api/mobile/v1`

## Autenticación

1. La aplicación inicia sesión con Supabase Auth usando únicamente la clave publicable.
2. Envía el `access_token` como `Authorization: Bearer <token>` en cada solicitud.
3. CIE Nexus verifica la firma y vigencia del JWT con Supabase.
4. El servidor carga la cuenta institucional vinculada y exige que esté activa.
5. La autorización utiliza los permisos institucionales almacenados; nunca `user_metadata` enviado por el usuario.

Las respuestas usan `Cache-Control: no-store, private`. No se admite autenticación móvil basada únicamente en cookies.

## Alcance clínico móvil

Un profesional puede ver un niño desde la aplicación sólo cuando se cumple al menos una condición:

- el niño está incluido en sus asignaciones institucionales; o
- el profesional es responsable de una cita programada o actualmente en curso con ese niño.

Este alcance es intencionalmente más estrecho que algunas vistas administrativas de la plataforma web. Dirección Clínica y otros roles superiores no reciben automáticamente todos los expedientes en la API móvil.

## Endpoints implementados

### `GET /bootstrap`

Devuelve la identidad institucional, rol, capacidades móviles, cantidad de niños visibles y próximas citas. No devuelve contraseñas, tokens ni permisos administrativos.

### `GET /children`

Requiere `children.view`. Devuelve exclusivamente los niños activos incluidos en el alcance móvil, con información resumida y cantidad de programas activos.

### `GET /children/{profileId}`

Requiere `children.view` y pertenencia al alcance móvil. Devuelve datos generales, planes y programas activos, targets, criterios estructurados, datos recientes, serie acumulativa y plantillas de nota únicamente cuando los permisos correspondientes lo permiten.

### `GET /calendar?from=AAAA-MM-DD&to=AAAA-MM-DD`

Requiere `calendar.view` o `calendar.manage`. Siempre devuelve sólo las citas del usuario autenticado. El rango se limita a 93 días por solicitud.

## Formato de respuestas

Respuesta correcta:

```json
{
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "serverTime": "2026-09-05T00:00:00.000Z"
  }
}
```

Error:

```json
{
  "error": {
    "code": "permission_denied",
    "message": "Tu rol no permite realizar esta acción desde la aplicación móvil."
  }
}
```

## Reglas obligatorias para la fase de escritura

- Una sesión móvil sólo podrá registrarse para una cita asignada al usuario autenticado.
- Cada operación deberá llevar un identificador único generado en el dispositivo para hacer la sincronización idempotente.
- Repetir una operación confirmada devolverá su resultado anterior y no duplicará ensayos, sesiones ni eventos de dominio.
- Las operaciones pendientes permanecerán cifradas en el dispositivo hasta recibir confirmación del servidor.
- El servidor volverá a validar programa, target, estado, criterio y asignación; no confiará en estados calculados por el teléfono.
- El motor clínico y la creación de eventos de dominio seguirán ejecutándose en CIE Nexus.
- Las correcciones de datos conservarán la auditoría clínica existente.
- Ningún dato de otro niño será aceptado dentro de una sesión aunque aparezca en el cuerpo de la solicitud.

## Exclusiones de la API móvil

La API móvil no expone creación de programas, administración de usuarios, configuración de permisos, plantillas institucionales, sedes ni otras funciones administrativas.
