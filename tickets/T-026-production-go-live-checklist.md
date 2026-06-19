# T-026 · Checklist de go-live + docs de despliegue a producción

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `docs/production-go-live-checklist`
- **OpenSpec change:** —  (documentación + nota de hardening)
- **PR:** —

## Requerimiento
Parte de «preparar la app para producción». No hay documentación de despliegue ni checklist de go-live:
el README apunta a un `memory/project_deployment.md` **que no existe**, y no hay notas de Stripe live-mode,
verificación de dominio en Resend, ni recomendación de CSP. Escribir un checklist de lanzamiento accionable.

## Estado actual (verificado)
- `README.md` referencia `memory/project_deployment.md` (inexistente); tiene sección Stripe Setup (test/local) pero
  sin pasos de live-mode.
- No hay checklist de go-live en README ni `ARCHITECTURE.md`.
- Resend: dominio remitente **hardcodeado** `noreply@photomarkt.com` en
  `src/lib/email/send-guest-purchase-email.ts` — requiere verificación de dominio en Resend antes del lanzamiento.
- Security headers existen en `next.config.ts` pero **sin Content-Security-Policy** (solo HSTS/X-Frame/etc.).

## Criterio de aceptación (Definition of Done)
- [ ] Doc de despliegue real (p. ej. `docs/deployment.md` o sección en README) — arreglar el enlace roto del README
- [ ] **Checklist de go-live** que cubra al menos:
      - [ ] Variables de entorno requeridas en Vercel (lista derivada de `env.mjs`: Supabase, Stripe, Resend, AWS, Inngest, `SITE_URL`)
      - [ ] **Stripe live-mode:** cambiar a live keys, `STRIPE_WEBHOOK_SECRET` del endpoint live, price IDs live
            (`STRIPE_PRICE_AMATEUR`/`_PRO`/`_YEARLY`), Stripe Connect en live
      - [ ] **Resend:** verificar el dominio de `noreply@photomarkt.com` (SPF/DKIM) antes de enviar en prod
      - [ ] **AWS Rekognition:** credenciales prod + `REKOGNITION_COLLECTION_PREFIX` por entorno
      - [ ] **Inngest:** `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` de la app de producción y endpoint `/api/inngest` registrado
      - [ ] **Migraciones:** confirmar que `migrate.yml` corre contra la BD prod con el secret `SUPABASE_DB_PASSWORD_PROD`
      - [ ] Smoke test post-deploy (login Google, crear evento, compra de prueba, webhook Stripe, email)
- [ ] Nota de hardening **CSP**: documentar que falta `Content-Security-Policy` y el plan (nonces por JSON-LD/inline);
      decidir si se añade aquí o como follow-up — **no** añadir una CSP a ciegas que rompa scripts inline
- [ ] Referencias cruzadas a tickets relacionados (T-021 terms, T-022 Sentry, T-023 analytics, T-024 cookies, T-025 health)
- [ ] Si se mueve/renombra algo documentado, actualizar `CLAUDE.md`/`ARCHITECTURE.md` en el mismo PR
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (doc-only no rompe nada)

## Notas
- Es mayormente **documentación**; la única parte de código posible es CSP, y solo si se valida que no rompe
  JSON-LD inline (`stringifyJsonLd`) ni Stripe/Sentry. Si hay duda, dejar CSP como follow-up documentado.
- No commitear secretos reales en el doc: usar placeholders y apuntar a dónde viven (Vercel env, GitHub secrets).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `docs/production-go-live-checklist`.
2. Acotado → implementar directo (sin OpenSpec).
3. Escribir doc + checklist; arreglar enlace roto del README.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin docs/production-go-live-checklist`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
