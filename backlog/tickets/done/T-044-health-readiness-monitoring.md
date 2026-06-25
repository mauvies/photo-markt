# T-044 · Monitoreo de servicios externos: readiness endpoint + dashboard + monitor externo

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/health-readiness-monitoring`
- **OpenSpec change:** —  (no aplicó: el ticket ya capturaba el spec completo; implementado directo + `/code-review`)
- **PR:** #99

> **Resuelto:** `GET /api/health/ready` con sondas read-only por servicio (Supabase/Stripe/AWS/Resend
> críticas; Inngest no-crítica por presencia de keys; Sentry/Google skipped), timeout 3s, roll-up
> ok/degraded/down, token (`HEALTH_CHECK_TOKEN`, compare constante-en-tiempo) + rate-limit, **sin filtrar
> el error** de la sonda. Dashboard `/dashboard/admin/status` gated a `admin_users`. `docs/monitoring.md`
> para el monitor externo. Reporte cacheado ~15s (fix de code-review: no martillear APIs de pago).

## Requerimiento
Poder monitorear que **todos los servicios externos** estén vivos y con credenciales válidas, en **staging y production**. Hoy solo existe `GET /api/health` (liveness puro, PR #83 / T-025), cuyo propio comentario dice que los chequeos de dependencias deben ir en un **readiness endpoint** aparte. Tres piezas:

1. **`GET /api/health/ready`** (readiness): corre sondas *read-only* en paralelo, cada una con timeout (~3s), y devuelve `{ status, environment, checks: [{ service, status: 'ok'|'down'|'skipped', latencyMs }] }`. **Nunca** filtrar el detalle del error (puede contener secretos) — solo `service` + `status` + `latencyMs`. `status` global = `down` si alguna sonda crítica falla. Sondas por servicio:
   - **Supabase**: `supabaseAdmin.from('profiles').select('id').limit(1)`
   - **Stripe**: `stripe.balance.retrieve()` (gratis, valida la API key)
   - **AWS Rekognition**: `ListCollectionsCommand({ MaxResults: 1 })` (gratis)
   - **Resend**: `resend.domains.list()` (valida la key sin enviar correo)
   - **Inngest**: GET interno a `/api/inngest` (introspección; prueba que el worker está registrado)
   - **Sentry**: reportar `ok`/`skipped` según haya DSN configurado (no hay read API; mandar evento contaminaría el dashboard)
   - **Google Places**: `skipped` server-side (la key está restringida por HTTP-referrer; solo validable en browser)
   - **Vercel**: implícito (si el endpoint responde, la plataforma está arriba)
2. **Dashboard interno** (ej. `/dashboard/admin/status`): semáforos verde/rojo por servicio que consume el endpoint. Acceso solo admin (`admin_users` vía `supabaseAdmin`).
3. **Monitor externo**: documentar/configurar un monitor gratuito (Better Stack / UptimeRobot) apuntando al endpoint en ambas URLs (staging y prod) con alertas. Doc en `docs/`.

## Criterio de aceptación (Definition of Done)
- [ ] `GET /api/health/ready` devuelve el JSON con el estatus por servicio y un `status` global, con `Cache-Control: no-store`
- [ ] Cada sonda tiene timeout (~3s) y **nunca** expone el mensaje de error crudo en la respuesta
- [ ] Protegido con token secreto: nueva env var `HEALTH_CHECK_TOKEN` (agregada a `env.mjs` y `.env.example`), vía header/query; sin token → 401
- [ ] Rate-limited con `src/lib/rate-limit.ts` (pega a APIs de pago)
- [ ] Dashboard `/dashboard/admin/status` pinta semáforos por servicio; gated a `admin_users`
- [ ] `docs/` documenta el wiring del monitor externo (URLs staging+prod, header del token, alertas)
- [ ] strings nuevos del dashboard en `en.json` y `es.json`
- [ ] test de feature: el endpoint reporta `ok`/`down`/`skipped` correctamente (mockear las sondas), 401 sin token, y rate-limit
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Follow-up directo de T-025** (health endpoint liveness, PR #83): este es el "readiness endpoint" que aquel comentario anticipaba. No es duplicado — T-025 es liveness puro (`{status:'ok'}` sin tocar dependencias).
- Entorno staging vs production se distingue por `NODE_ENV` / `SITE_URL` — cada deployment expone su propio endpoint; el monitor externo apunta a ambas URLs.
- El monitor externo es la pieza que cubre "app entera caída": un dashboard interno se cae junto con la app.
- Clientes ya inicializados a reusar: `src/database/supabase-admin.ts`, `src/lib/stripe/config.ts`, `src/lib/aws/rekognition-client.ts`, `src/lib/inngest/client.ts`, Resend en `src/lib/email/`.
- Caveats conocidos: Inngest no tiene SDK health-check (solo introspección del worker); Google Places no es probable server-side por restricción de referrer; Sentry no tiene read API.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
