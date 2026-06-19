# T-024 · Banner de consentimiento de cookies (GDPR)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno (Dep lógico: T-023 ya mergeado)
- **Rama:** `feat/cookie-consent-banner`
- **OpenSpec change:** —  (UI + i18n acotado)
- **PR:** —

## Requerimiento
Parte de «preparar la app para producción». No hay banner de consentimiento de cookies. Para el mercado
España/EU (GDPR) hace falta pedir consentimiento antes de cargar analytics no esenciales. Añadir un banner
ligero que persista la decisión y **gatee la carga de analytics** (T-023).

## Estado actual (verificado)
- Sin componente de consentimiento de cookies en el codebase.
- T-023 monta Vercel Web Analytics sin gating de consentimiento (por eso este ticket lo cubre).

## Criterio de aceptación (Definition of Done)
- [ ] Banner de cookies (componente nuevo en `src/components/`) con acciones Aceptar / Rechazar, accesible y responsive
- [ ] Decisión persistida en `localStorage` con clave namespaced `photo-markt_cookie_consent` (convención del repo)
- [ ] Analytics (T-023) **solo se carga si hay consentimiento**; sin consentimiento o tras rechazar, no se carga
- [ ] Banner no reaparece una vez decidido; enlace para revisar/cambiar la preferencia
- [ ] Strings nuevos en `en.json` **y** `es.json` (título, descripción, aceptar, rechazar, enlace a privacidad)
- [ ] Enlaza a `/privacy-policy` (y a `/terms` si aplica)
- [ ] Se ve bien en mobile y desktop, en ambos idiomas; no tapa la bottom nav de talento en mobile
- [ ] Test del gating de consentimiento (sin consentimiento → analytics no monta); falla antes, pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Mantenerlo **simple**: sin librería pesada de CMP; un banner propio + un helper de consentimiento alcanza.
- Decidir si Sentry (T-022) cuenta como esencial (interés legítimo, sin consentimiento) o se gatea también —
  por defecto Sentry esencial, analytics tras consentimiento.
- Toca `layout.tsx` y `en/es.json` → ejecutar **después** de T-023 (analytics) y de T-021 (terms, también toca i18n),
  con esos PRs ya mergeados, para evitar conflictos de diccionario/layout.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/cookie-consent-banner`.
2. Acotado → implementar directo (sin OpenSpec).
3. Banner + helper de consentimiento + gating de analytics + i18n + test.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/cookie-consent-banner`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
