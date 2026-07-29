# T-198 · Error de Next intermitente en `/[lang]/dashboard/talent` mientras redirige

- **Prioridad:** P1
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/talent-dashboard-redirect-error`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
"A veces cuando la página navega a la ruta `https://www.photomarkt.com/en/dashboard/talent`, mientras
redirige a la página que corresponde, muestra un error de Next en la ruta
`https://www.photomarkt.com/en/dashboard/talent`."

Es decir: `/[lang]/dashboard/talent` no tiene contenido propio — es una página de puro redirect a
`/[lang]/dashboard/talent/events` — pero de forma **intermitente**, antes de que el redirect complete,
el usuario ve la pantalla de error de Next en vez de una transición limpia.

## Contexto técnico (punto de partida del diagnóstico, no conclusión)
- `src/app/[lang]/dashboard/talent/page.tsx` es 11 líneas: llama `localizedRedirect(lang, '/dashboard/talent/events')`.
- `localizedRedirect` (`src/lib/i18n/redirect.ts`) envuelve `redirect()` de `next/navigation`, que
  **funciona lanzando** una excepción con digest `NEXT_REDIRECT`.
- El **layout** de la misma ruta (`dashboard/talent/layout.tsx`) también puede redirigir (sin rol →
  `/onboarding/role`; sin rol talent → `/dashboard`), así que layout y page pueden lanzar `NEXT_REDIRECT`
  en el mismo render.
- Hay un `error.tsx` en `src/app/[lang]/` y un `loading.tsx` en la misma ruta.

Hipótesis a verificar (ordenadas por probabilidad, **el ticket empieza por diagnóstico**):
1. El `NEXT_REDIRECT` que lanza la page/layout está siendo **atrapado y renderizado** como error por el
   error boundary de `src/app/[lang]/error.tsx` (o por un `try/catch` intermedio en el path de auth/rol).
2. Condición de carrera con la **sesión de Supabase**: el layout hace `getUser()`/`getRoleContext()`; si
   el refresh de sesión de `src/proxy.ts` no ha corrido o falla, el layout revienta antes del redirect.
3. Prefetch / navegación soft: el `<Link>` que apunta a `/dashboard/talent` dispara el render en el
   cliente y el fallo aparece ahí, no en un hard load (explicaría el "a veces").
4. Fallo real y ajeno al redirect (p.ej. `getDictionary`/query lenta que hace timeout en Vercel), que
   solo se hace visible en esta ruta porque no tiene contenido que enmascare el error.

Antes de tocar código: reproducir y **capturar el error real** (mensaje + digest) desde los logs de
Vercel y/o Sentry (`SENTRY_DSN` ya cableado) para el path `/en/dashboard/talent`.

## Criterio de aceptación (Definition of Done)
- [ ] Diagnóstico escrito: causa raíz confirmada con evidencia (log/digest de Vercel o Sentry), no supuesta
- [ ] Navegar a `/[lang]/dashboard/talent` (hard load y navegación soft, `en` y `es`) **nunca** muestra la
      pantalla de error de Next: siempre aterriza en `/[lang]/dashboard/talent/events`
- [ ] El redirect no queda atrapado por ningún error boundary ni `try/catch` (`NEXT_REDIRECT` se re-lanza)
- [ ] Los otros redirects del layout siguen funcionando: sin rol → `/onboarding/role`; sin rol talent →
      `/dashboard` (no se rompen al arreglar este)
- [ ] strings nuevos en `en.json` y `es.json` (si hay UI — probablemente no hay)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Es intermitente** → un test de regresión determinista tiene que atacar la causa raíz confirmada
  (p.ej. que el error boundary re-lance `NEXT_REDIRECT`, o guard source-level de que no haya `try/catch`
  alrededor del redirect), no "navegar y ver si falla".
- Mismo patrón de página-solo-redirect en `src/app/[lang]/dashboard/page.tsx` y probablemente en el
  dashboard de fotógrafo: si la causa es genérica (error boundary / helper de redirect), **arreglarla en el
  punto compartido** y verificar que las otras rutas de redirect quedan cubiertas.
- No confundir con T-187 (nav soft vs hard hacia el carrito) — ahí el síntoma era un flash de skeleton,
  aquí es una pantalla de error.
- Familia: T-095 (`getRoleContext`, una sola ida a auth en este layout) / T-168 (prefijo de locale).
