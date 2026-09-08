# CIE Nexus

Repositorio privado de desarrollo de **CIE Nexus**, plataforma clínica ABA y aplicación Android del CIE.

## Estado del traspaso

Este repositorio se creó como destino oficial para compartir el desarrollo con el equipo de tecnología. **El código fuente original aún no se ha importado a este repositorio**; no debe reconstruirse desde el APK ni sustituirse por una implementación nueva.

Checkpoint técnico conocido:

- Proyecto Sites: `appgprj_6a74ae9afea481918d0095af22adaf62`
- Rama de revisión: `pilot-review-0.3.0`
- Base recuperada: `87c78a1d7a4ebb50f83dd14b46d149c48ff7c7d0`
- APK v0.3.1 generada desde: `dc4fac7`
- Sites 41 preparada desde: `cb01f262a5c1cb18f61579a5519dccbd27b86413`
- Último commit móvil conocido para v0.3.2: `8793081`
- Paquete Android: `org.cie.nexus.mobile`

## Regla de continuidad

El proyecto existente es la fuente de verdad. Al recuperar el worktree original:

1. conservar su historial Git y sus ramas cuando sea posible;
2. no reconstruir módulos que ya funcionan;
3. no crear una segunda fuente de datos;
4. excluir credenciales, secretos y datos clínicos reales antes de publicar cambios;
5. mantener el repositorio privado.

## Arquitectura conocida

La versión revisada utiliza:

- Supabase para identidad, roles y asignaciones;
- D1 para datos clínicos;
- SQLCipher local para borradores móviles;
- aplicación Android derivada del proyecto existente de CIE Nexus.

## Seguridad y privacidad

No deben incluirse en Git:

- archivos `.env` reales;
- API keys, tokens o claves privadas;
- claves de servicio de Supabase;
- keystores o contraseñas de firma Android;
- datos identificables de niños o familias;
- exportaciones de bases de datos con información real;
- conversaciones o prompts de ChatGPT.

Consultar `.gitignore` antes de importar el worktree.
