# T-179 · Construir el tab Share de la página de evento del fotógrafo

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (Dep **T-178** — el tab Share es su hogar; si T-178 no ha aterrizado, hay fallback: bloque standalone. Ver Notas)
- **Rama:** `feat/event-share-tab`  (tipo = feat)
- **OpenSpec change:** —  (probable innecesario: reusa componentes existentes, 1 tab; decidir al ejecutar)
- **PR:** —

## Requerimiento
Cuando un fotógrafo abre uno de sus eventos en `/dashboard/photographer/events/[id]`, no hay una forma fácil de agarrar el link para enviárselo a un atleta que pide sus fotos. El ticket de reestructura en tabs (**T-178**) crea un tab **"Share"** como su hogar — este ticket lo llena.

**Modo de ejecución: execution, autónomo.**

### Alcance — el tab Share contiene:
- La **URL compartible del evento, visible**.
- Un **botón de copiar con feedback de confirmación** (toast o "copiado" inline).
- Las **opciones de compartir existentes** (native share / social), **reusando el componente de share ya usado** en el event card y la página pública del evento (`EventShareButton` → `shareUrl` de `src/lib/share-url.ts`). **NO construir uno nuevo.**
- **QR code fuera de alcance.**

### CRÍTICO — la URL debe ser la que realmente funciona
Resolver la URL correcta desde la **lógica de URL compartible existente** (la página pública y el event card ya lo hacen), **no** construirla ad hoc:
- **Evento público** → la URL pública del evento (`/{locale}/events/{slug ?? id}`).
- **Evento privado** → la URL **INCLUYENDO el share code** (`/{locale}/events/{share_code}`). Ese código es la llave de acceso; un link sin él es inútil para el destinatario y la feature **falla en silencio**.
  - **Confirmado en código:** la ruta `[lang]/events/[shareCode]/page.tsx` resuelve UUID y slug **solo si `is_public = true`**; los eventos privados **solo** resuelven vía `getEventByShareCode`. Por eso un evento privado **obliga** a usar `share_code` en la URL.
- Si el evento está **gated (reveal gate habilitado, T-177)**: el link sigue siendo la URL normal del evento — el gate gobierna la **visibilidad de las fotos**, no el acceso al evento. Sin manejo especial, pero **confirmar que el copy no da a entender que el destinatario verá las fotos directamente**.

## Criterio de aceptación (Definition of Done)
- [ ] En el tab Share, la **URL compartible del evento es visible** (texto seleccionable), resuelta correctamente por tipo de evento (público → `slug ?? id`; privado → `share_code`) con prefijo de locale.
- [ ] **Botón de copiar** con confirmación (toast o "copiado" inline transitorio).
- [ ] Las opciones native-share/social reusan **`EventShareButton`** (o el componente compartido existente) — sin componente nuevo.
- [ ] **Para un evento PRIVADO, la URL copiada da acceso al abrirla en una ventana de incógnito** (criterio explícito del usuario — el reviewer debe pegarla en incógnito y confirmar que funciona).
- [ ] Para un evento público, la URL copiada abre la página pública del evento.
- [ ] Con reveal gate habilitado, el link es la URL normal del evento; el copy **no** implica que el destinatario verá las fotos directamente.
- [ ] QR **no** incluido en este ticket.
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (resolución de URL: público usa slug/id, privado usa share_code, prefijo de locale presente).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Dependencia / fallback (del usuario):** este ticket asume que **T-178** (tabs) aterrizó. Si **no**, añadir la sección de share como **bloque standalone** en la página del evento, posicionado para que **no empuje la gestión de fotos below the fold** — y **notar en el PR** que debe moverse al tab Share cuando existan los tabs. Ejecutar idealmente **después de T-178** para evitar el rework.
- **Componentes/lógica a reusar (verificado):**
  - `EventShareButton` (`src/components/event-share-button.tsx`) → `shareUrl(title, url)` de `src/lib/share-url.ts` (Web Share API con fallback a clipboard). Es el mismo que usa `event-card.tsx`.
  - Patrón de URL del event card (`event-card.tsx:279`): `${origin}/${locale}/events/${slug ?? id}` — **asume público**; para privado hay que sustituir por `share_code`.
  - `EventShareCode` (`src/components/event-share-code.tsx`) ya renderiza un bloque de **código** (no la URL completa) con copiar + QR, hoy en la página del evento. Ojo: muestra el `share_code` pelado y construye `${origin}/events/${shareCode}` **sin prefijo de locale**. Este tab quiere la **URL completa visible** + copiar + native/social; reutilizar lo que aplique pero **la URL debe llevar locale** y resolver público vs privado.
- **Hueco a resolver (heads-up para quien ejecute):** la "lógica de URL compartible" **no está centralizada** en un solo helper hoy (event-card asume público con `slug ?? id`; EventShareCode usa `share_code` sin locale). Opción limpia: extraer un pequeño resolver compartido `getShareableEventUrl(event, locale, origin)` que devuelva público→`slug ?? id` / privado→`share_code` con prefijo de locale, y usarlo aquí (y opcionalmente refactorizar los call-sites existentes — **pero eso sería "otros cambios"**, así que mantenerlo acotado al tab salvo que sea trivial).
- **Datos disponibles:** `page.tsx` ya tiene `event` con `is_public`, `slug`, `share_code`, `name` y el `lang` — todo lo necesario para resolver la URL server-side y pasarlo al componente cliente del tab.
- **Fuera de alcance:** QR, cualquier otro cambio.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-share-tab`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` — el reviewer debe **pegar el link privado copiado en incógnito** y confirmar que da acceso.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
