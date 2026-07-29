# T-198 · Error de Next intermitente en `/[lang]/dashboard/talent` mientras redirige

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/talent-dashboard-redirect-error`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** #262

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
- [x] Diagnóstico escrito: causa raíz confirmada con evidencia (digests del payload RSC + log del servidor), no supuesta
- [x] Navegar a `/[lang]/dashboard/talent` (hard load y navegación soft, `en` y `es`) **nunca** muestra la
      pantalla de error de Next: siempre aterriza en `/[lang]/dashboard/talent/events`
- [x] El redirect no queda atrapado por ningún error boundary ni `try/catch` (`NEXT_REDIRECT` se re-lanza)
- [x] Los otros redirects del layout siguen funcionando: sin rol → `/onboarding/role`; sin rol talent →
      `/dashboard` (no se rompen al arreglar este)
- [x] strings nuevos en `en.json` y `es.json` — no hay UI nueva, es solo guard: diccionarios intactos
- [x] test de regresión que falla antes y pasa después
- [x] `pnpm typecheck && pnpm lint` en verde (+ `pnpm build`); unit verde salvo los **2 fallos
      pre-existentes ajenos** de `main` (`event-card-skeleton`, `route-loading-skeletons`)

## Resultado

**Causa raíz:** Next renderiza los segmentos de una ruta (layout padre → layout hijo → page) **en
paralelo**, así que el guard de login de `dashboard/layout.tsx` **no impide** que sus hijos se ejecuten.
Sin sesión, el layout de talento llegaba a `getRoleContext()`, que **lanza** un `Error` plano, y ese
error corría contra el `NEXT_REDIRECT` del padre hacia el error boundary de `[lang]/error.tsx`. Gana el
que resuelva primero → intermitente. Ninguna de las 4 hipótesis del ticket era exacta: el error boundary
**no** atrapa `NEXT_REDIRECT` (hipótesis 1), y no hacía falta ninguna condición de carrera de sesión
(hipótesis 2) — basta con no tener sesión.

**Evidencia:** una sola petición deslogueada a `/en/dashboard/talent` devolvió **HTTP 200** con los tres
desenlaces a la vez en el payload:
```
NEXT_REDIRECT;replace;/en/dashboard/talent/events;307        ← la page
NEXT_REDIRECT;replace;/en/login?next=%2Fdashboard%2Ftalent;307 ← el guard del padre
digest 632070002 + "You must be signed in to manage roles."  ← el layout de talento LANZA
```
y el servidor logueó `⨯ Error: You must be signed in to manage roles.`

**Arreglo:** `requireUser()` (`src/lib/auth/require-user.ts`) — resuelve el usuario por el `getUser()`
cacheado por request (un único snapshot de auth para todos los segmentos) y redirige a login si no hay.
Se llama primero en cada segmento del dashboard que lee datos dependientes de auth, así **todos** los
desenlaces en carrera son redirects. El barrido de todas las rutas del dashboard deslogueado encontró el
mismo defecto en `/dashboard/photographer`, `/dashboard/talent/orders` y `/dashboard/talent/profile`,
arreglados también.

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
