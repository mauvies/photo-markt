# T-021 · Completar y dejar lista para producción la página de Términos de Servicio

- **Prioridad:** P1
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `feat/terms-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado, mismo patrón que T-016)
- **PR:** —

## Requerimiento
Parte de «preparar la app para producción». La página pública `/terms` hoy es solo un placeholder
(`dict.staticPages.preparing`). Escribir contenido legal real de Términos de Servicio, traducido es+en,
coherente con cómo opera la app, y dejarla lista para lanzamiento. Mismo tratamiento que se dio a Privacy en T-016.

## Estado actual (verificado)
- `src/app/[lang]/terms/page.tsx` (~14 líneas) — **ya usa i18n** pero solo renderiza
  `dict.staticPages.termsTitle` + `dict.staticPages.preparing` (placeholder).
- Claves en `staticPages`: `preparing`, `termsTitle`, `privacyTitle`, `aboutTitle`, `contactTitle`.
- El foco es **escribir contenido**, no cablear desde cero.

## Criterio de aceptación (Definition of Done)
- [ ] `/terms` con contenido completo y production-ready en `es` y `en` (ya no usa `preparing`)
- [ ] Términos coherentes con el modelo real: marketplace de fotos deportivas, suscripciones de fotógrafo
      (Free/Starter/Pro + comisión), compras one-time de talent, Stripe Connect para payouts, watermark,
      búsqueda por selfie con AWS Rekognition (selfies efímeras), propiedad/licencia de las fotos
- [ ] Secciones mínimas: aceptación, cuentas y roles, contenido del usuario y licencias, pagos y reembolsos,
      conducta prohibida, propiedad intelectual, limitación de responsabilidad, terminación, ley aplicable, contacto
- [ ] Nuevas claves i18n en `en.json` **y** `es.json` (sin texto en inglés colado en ES, sin claves faltantes)
- [ ] Se ve bien en mobile y desktop, en ambos idiomas; enlazada donde corresponda (footer/checkout)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Contenido legal: describir el manejo real (no inventar cláusulas que no apliquen). Si hay dudas legales de fondo,
  marcarlas como TODO visible, no improvisar promesas.
- Reutilizar el layout/estilo de `/privacy-policy` para consistencia.
- Mismo patrón que T-014/T-015/T-016.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/terms-page-i18n-production`.
2. Acotado → implementar directo (sin OpenSpec).
3. Implementar/completar contenido + i18n (en+es).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/terms-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
