# T-022 · Monitoreo de errores en producción con Sentry

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/sentry-error-monitoring`
- **OpenSpec change:** —  (integración acotada; sin BD/pagos)
- **PR:** #79

## Requerimiento
Parte de «preparar la app para producción». Hoy **no hay monitoreo de errores**: en producción las excepciones
serían silenciosas. Integrar **Sentry** (estándar de facto en Next.js App Router) para captura de errores de
servidor y cliente, con DSN configurable por entorno.

## Estado actual (verificado)
- Sin Sentry/Datadog/PostHog. Cero dependencias de error-tracking en `package.json`.
- Un comentario en `src/app/api/watermark/[...path]/route.ts` menciona "alert-able in Sentry/Datadog" — aspiracional.

## Criterio de aceptación (Definition of Done)
- [ ] `@sentry/nextjs` instalado y configurado (instrumentation server/edge + client config) vía el wizard/patrón oficial
- [ ] Captura activa solo con DSN presente: **no-op sin `SENTRY_DSN`** (dev/test sin ruido ni envíos)
- [ ] `next.config.ts` envuelto con `withSentryConfig` sin romper headers/images/remotePatterns ya configurados
- [ ] Nuevas env vars añadidas a `env.mjs` (T3 Env): `SENTRY_DSN` (y `NEXT_PUBLIC_SENTRY_DSN` si aplica) como
      **opcionales** (la app debe arrancar sin ellas); documentadas en README/CLAUDE env section
- [ ] No se filtra PII sensible: respetar `safeCall` y no enviar buffers de imagen ni selfies a Sentry
      (revisar `beforeSend`/scrubbing por defecto)
- [ ] Sin claves i18n nuevas (no es UI visible)
- [ ] Test que verifique el gating (sin DSN → cliente no inicializa / no envía); falla antes, pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Sourcemaps:** subir en build de Vercel solo si hay `SENTRY_AUTH_TOKEN`; sin token, build normal (no romper Vercel Hobby).
- Mantener `tunnelRoute` opcional para evitar adblockers; revisar que no choque con CSP futura (ver T-026).
- Errores de monitoreo suelen tratarse como interés legítimo; coordinar con el banner de cookies (T-024) si se
  decide gatear también Sentry tras consentimiento.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/sentry-error-monitoring`.
2. Acotado → implementar directo (sin OpenSpec). No toca pagos/auth/BD.
3. Integrar Sentry + gating por DSN + env.mjs + test.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/sentry-error-monitoring`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
