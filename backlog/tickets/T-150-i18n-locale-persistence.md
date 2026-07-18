# T-150 · El idioma elegido no persiste al navegar (revierte a español)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/i18n-locale-persistence`  (tipo = fix)
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
Cuando visito la landing (`/[lang]`) y selecciono un idioma — por ejemplo inglés — y luego navego a
otra página (por ejemplo un evento `/events/[shareCode]`), el idioma vuelve a cambiar a español. La
elección de idioma no se respeta al navegar.

## Causa raíz (confirmada leyendo el código)
Tres capas que se combinan:

1. **Links de la landing/explore sueltan el prefijo `/[lang]`.** `src/app/[lang]/page.tsx:46` **y**
   `src/app/[lang]/events/page.tsx:73` pasan `eventLinkPrefix="/events"` (sin `/${lang}`). Fluye por
   `events-explore-view.tsx:121` → `event-grid.tsx:106` → `EventCard`, que arma
   `eventHref = ${linkPrefix}/${id}` (`event-card.tsx:262`) → `/events/[shareCode]` en vez de
   `/en/events/[shareCode]`. Al hacer clic, el path no lleva locale y el middleware re-decide el idioma
   desde cero. (Patrón correcto ya existe: `photographer-public-profile.tsx:153` usa `` `/${lang}/events` ``.)
2. **El middleware siempre cae a `es`.** En `src/proxy.ts:36-37`, la rama de detección hace
   `acceptLang.toLowerCase().startsWith('es') ? 'es' : defaultLocale`, pero `defaultLocale = 'es'`
   (`src/lib/i18n/config.ts:3`) → **ambas ramas devuelven `'es'`**. Cualquier path sin prefijo de
   idioma redirige a `/es/...`, nunca a `/en`. (Además solo mira `accept-language`, nunca una cookie.)
3. **El switcher no persiste la elección, y la cookie que ya existe está muerta.**
   `src/components/language-switcher.tsx` solo reescribe la URL a `/en/...` (`buildHref`/`localizedPath`);
   no setea cookie. Ojo: ya existe el helper `localeFromCookie` (`src/lib/i18n/client-locale.ts`) que
   **lee** una cookie `preferred-locale` — la consumen `not-found.tsx:13`, `error.tsx:28` y
   `auth/callback/route.ts:22` — pero **nada la escribe** (solo un test la setea) y `proxy.ts` no la lee.
   O sea: hay que **escribir** `preferred-locale` al cambiar idioma y **leerla** en el middleware;
   reusar ese nombre de cookie, no inventar `NEXT_LOCALE`.

## Criterio de aceptación (Definition of Done)
- [ ] Desde la landing en inglés (`/en`), hacer clic en una event card lleva a `/en/events/[shareCode]`
      y la página se muestra en inglés (no revierte a español).
- [ ] El switcher de idioma persiste la elección en la cookie existente `preferred-locale` al cambiar.
- [ ] El middleware, ante un path SIN prefijo de idioma, resuelve el locale con este orden:
      cookie `preferred-locale` (si válida) → `accept-language` → `defaultLocale`; y de hecho puede
      resolver a `en` (arreglar el ternario de `proxy.ts` que hoy devuelve `es` en ambas ramas).
- [ ] Auditar/arreglar los links internos que sueltan el prefijo `/[lang]`: `page.tsx:46` y
      `events/page.tsx:73` (`eventLinkPrefix="/events"` → `` `/${lang}/events` ``), preservando el
      locale actual.
- [ ] strings nuevos en `en.json` y `es.json` (solo si se agrega UI; probablemente no)
- [ ] test de regresión que falla antes y pasa después (p. ej. unit del resolver de locale del
      middleware: cookie `en` + un path sin prefijo → `/en/...`; y/o test de que `eventLinkPrefix`
      lleva el locale)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Enfoque recomendado: **reactivar la cookie `preferred-locale` ya existente** como fuente de verdad de
  la preferencia (robusta frente a links que sueltan el prefijo y a entradas directas), + arreglar el
  ternario del middleware, + preservar el prefijo en los links. La cookie por sí sola no basta si un
  link entra sin locale y el middleware sigue defaulteando mal; el arreglo del ternario por sí solo no
  persiste la preferencia manual (un usuario con `accept-language: es` que elige inglés volvería a
  `es`). Por eso las tres. Bonus: cablear la cookie también arregla que `not-found.tsx`/`error.tsx`/
  `auth/callback` ya la leen pero hoy siempre reciben null.
- No confundir con la preferencia de idioma de settings (`dashboard/*/settings/language/page.tsx`),
  que es otra superficie; verificar que no dupliquen lógica.
- No hay ticket i18n abierto que se solape (T-014/T-015/T-016 fueron páginas i18n, ya archivadas).
- Correr `pnpm build` además de los tests: el cambio toca `proxy.ts` (middleware) + componente
  cliente compartido.

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
