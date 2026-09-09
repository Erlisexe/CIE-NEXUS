# CIE Nexus Mobile

Aplicación móvil clínica para el trabajo del profesional durante terapia.

## Fase 1

- Acceso con la cuenta institucional de CIE Nexus.
- Resumen del día.
- Niños asignados o vinculados a una cita propia.
- Expediente móvil con datos generales, programas, targets, plan y progreso acumulativo.
- Calendario personal.
- Perfil y cierre de sesión.
- Conexión exclusiva con la API móvil versionada de CIE Nexus.

## Fase 2

- Una sesión con todos los programas activos y targets abiertos del niño.
- Ensayos discretos 1/0 sin límite basado en el criterio, corrección auditada y deshacer.
- Frecuencia con cero observado explícito; duración y latencia acumuladas en segundos, como en la web.
- Nota estructurada desde las plantillas institucionales y Registro ABC.
- Guardado inmediato en SQLite con SQLCipher; clave por usuario en SecureStore. Las copias de seguridad Android están desactivadas.
- Preparaciones descargadas, agenda, expedientes consultados y borradores disponibles sin conexión mientras existe una sesión de acceso local.
- Recuperación en pausa: al regresar desde segundo plano o un cierre inesperado se revisa el tiempo antes de continuar. Un cierre abrupto conserva el último control de tiempo (cada cinco segundos) y todas las respuestas confirmadas.
- Cola persistente que sincroniza al cerrar, al volver al primer plano y cada veinte segundos con la app abierta. No se garantiza sincronización con la aplicación cerrada.
- Cierre con identificador estable y hash de contenido; reintentos y dos envíos simultáneos devuelven el mismo recibo.
- El servidor verifica otra vez cuenta, cita, niño, programas, mediciones, criterios, plantilla y permiso ABC. Un conflicto conserva los datos para revisión.
- Una sola transacción D1 conserva encuentro, resultados por programa, ABC, nota, auditoría, transiciones y eventos de dominio. Se reutiliza `lib/clinical-mastery.ts`.
- Las gráficas y estados se actualizan después de la confirmación del servidor, no durante el trabajo offline.

La API `/api/mobile/v1/collection` y la migración aditiva `0021` deben estar publicadas antes de usar esta versión con producción.

## Desarrollo local

1. Copiar `.env.example` como `.env` y completar la clave publicable de Supabase.
2. Ejecutar `npm install`.
3. Crear una compilación nativa con `expo prebuild --platform android` y Android Gradle o con el perfil EAS de prueba interna. SQLCipher requiere compilación nativa y no funciona en Expo Go.

Nunca se debe incluir una clave secreta o `service_role` en este proyecto.
