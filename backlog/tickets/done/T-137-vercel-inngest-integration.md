# T-137 · [Infra/Inngest] Instalar la integración Vercel↔Inngest para auto-sync en cada deploy

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** — (config de infra en Vercel/Inngest, sin cambios de código)
- **OpenSpec change:** —
- **PR:** — (sin PR; config de dashboard)

## Resolución (2026-07-15)
Integración Vercel↔Inngest configurada por el usuario: generada la key de **Protection Bypass for
Automation** en Vercel y cargada en Inngest (deja pasar los requests de Inngest a `/api/inngest`
pese a la Deployment Protection de prod). **Verificado empíricamente:** el merge del PR #191
disparó un deploy y el app de Inngest **se re-sincronizó solo** (apareció el sync automático sin
disparo manual). El drift 5/13 no vuelve a pasar. Queda pendiente T-138 (reconciliar lo que estuvo
muerto durante el período de drift).

## Requerimiento
Causa raíz descubierta en T-125: el app de Inngest de **producción quedó synceado viejo** —
solo 5 de 13 funciones estaban registradas. Inngest no descubre funciones nuevas solo; el app
tiene que re-sincronizarse en cada deploy. Como eso no está automatizado, todo lo que se agregó
al código después del último sync manual estuvo **muerto en prod**:
`generate-photo-thumbnails`, el cron `reconcile-indexing-state`, `detect-photo-bibs`, los
`cleanup-orphaned-storage*` (cron), `disable-event-indexing`, `cleanup-on-event-delete`, y los
`backfill-event-*`. El indexado de caras funcionaba solo porque era una de las 5 viejas.

Se re-sincronizó **a mano** para desbloquear T-125, pero sin fix permanente el drift vuelve la
próxima vez que se agregue/edite una función Inngest.

## Criterio de aceptación (Definition of Done)
- [ ] Instalada la integración oficial de Inngest en Vercel (Marketplace) y conectada al proyecto
      `photo-markt`, entorno **production** (y preview si aplica).
- [ ] Verificado que un deploy nuevo re-sincroniza automáticamente (agregar/tocar una función y
      confirmar que aparece en el app de Inngest sin sync manual).
- [ ] Confirmadas las env vars gestionadas por la integración (`INNGEST_SIGNING_KEY` /
      `INNGEST_EVENT_KEY`) en el entorno correcto.
- [ ] Documentado en `ARCHITECTURE.md`/CLAUDE.md el mecanismo de sync (para que no se vuelva a
      asumir que "se sincroniza solo").

## Notas
- Origen: T-125 (diagnóstico de prod: 300 originales / 0 thumbnails por el sync viejo).
- Alternativa/stopgap si la integración no se puede instalar ya: un paso de deploy hook que haga
  el PUT a `/api/inngest` de prod. La integración es el fix correcto.
- Relacionado: T-138 (auditar/reconciliar lo que estuvo muerto en prod).
