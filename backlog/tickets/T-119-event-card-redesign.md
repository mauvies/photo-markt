# T-119 · Rediseño del event card (portada arriba + sección de info estructurada)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/event-card-redesign`
- **OpenSpec change:** —  (un componente + su plumbing de datos; UI con requerimiento claro, implementar directo)
- **PR:** —

## Requerimiento
Rediseñar el `EventCard` a un layout más limpio y estructurado (estilo referencia tipo SurfCloud, solo
inspiración de layout): tarjeta redondeada con la **portada arriba** (esquinas superiores redondeadas) y
una **sección de info abajo** (título con iconos de acción, ubicación con bandera del país, fecha + hora, y
el fotógrafo en una sección separada por un divisor). Mover el indicador de tipo de evento y quitar el
icono de "like" viejo.

### 1. Estructura de la tarjeta
- Toda la tarjeta con esquinas redondeadas; la portada arriba (top redondeado), la info debajo en un
  contenedor con padding. Portada con aspect ratio consistente (~16:10) y `object-cover`.
  - **Hoy:** la portada es `aspect-square rounded-xl` (`event-card.tsx:241`) — cambiar a ~16:10 y separar
    la sección de info debajo.

### 2. Indicador de tipo de evento
- Hoy es un icono overlay arriba-**derecha** de la portada (`ActivityBadge`, `event-card.tsx:178`,
  `right-3 top-3`). Moverlo arriba-**izquierda** (overlay sobre la imagen). Sigue siendo el mismo indicador
  de tipo/categoría; solo cambia la posición.
  - **Ojo:** el slot arriba-izquierda ya lo usa a veces `moreMenuSlot` (dropdown owner con edit/delete,
    `event-card.tsx:68`). Coordinar posiciones para que no choquen (p. ej. el badge solo en vistas sin el
    dropdown owner, o desplazarlo).

### 3. Iconos de acción a la derecha del título (share + guardar en favoritos)
- Dos iconos pequeños a la derecha del título, replicando el patrón del **detalle de evento**: **share** y
  **guardar (corazón)**. **Reusar exactamente** los mismos componentes/lógica que el detalle:
  - Share → `src/components/event-share-button.tsx` (comparte la URL pública del evento).
  - Guardar (corazón) → `src/components/event-save-button.tsx` (variant `icon`, T-082): solo usuarios
    autenticados, estado toggle (relleno cuando está guardado), reusa la Server Action de saved-events
    existente. Para invitados: replicar lo que hace el detalle (ocultar o promover login al click).
- **Quitar** el icono "like" viejo de abajo-derecha de la portada (el `saveSlot`, `event-card.tsx:71-75`,
  slot flotante bottom-right) — queda reemplazado por este corazón en la línea del título.

### 4. Sección de info (debajo de la imagen), en este orden
1. **Título** — prominente (p. ej. `text-lg font-semibold`), en una línea con share + corazón alineados a
   la derecha.
2. **Ubicación** — algo más grande/bold que hoy, **sin** el icono de pin (`MapPin`, hoy en la línea de
   ubicación). Al final del texto de ubicación, una **bandera del país** (ver nota 5).
3. **Fecha + hora en una línea:** fecha a la izquierda, hora de sesión a la derecha (o inline separadas por
   "•"), estilo referencia. Si el evento **no** tiene hora, mostrar solo la fecha limpiamente (sin
   slot vacío ni "undefined").
4. **Fotógrafo** — sección al fondo separada por un **divisor** (border-top). Avatar pequeño redondeado +
   nombre; el nombre enlaza al **perfil público** del fotógrafo (reusar la lógica de link existente).
   - **Verificar:** el prop `photographer` (`event-card.tsx:56`) trae `displayName`/`username`; confirmar si
     trae `avatar` — si no, enhebrarlo.

### 5. Bandera del país — **hallazgo de datos (ya investigado, confirmar al ejecutar)**
- `EventCard` **ya recibe** `country: string` estructurado (prop, `event-card.tsx:41`, desde T-107). **PERO**
  T-107 guarda `country` como el **nombre largo** de Google Places ("Spain", "United States"), **no un
  código ISO**, y está **vacío** en eventos legacy/pre-T-107 (que metían la dirección formateada en `city`).
- **Enfoque recomendado (no parsear texto libre):** mapear el nombre de país → bandera con un método
  **liviano** (emoji flags, o una tabla name→ISO chica; evitar deps pesadas), y **omitir la bandera
  limpiamente** cuando `country` está vacío o no mapea. Reportar en el PR el gap (país es nombre, no ISO;
  vacío en legacy) y, como follow-up opcional, si conviene persistir el **código ISO** del país (T-107 tiene
  el `address_component` con el short_name ISO disponible) — **no** implementar esa migración aquí salvo que
  sea trivial y de bajo riesgo.

### 6. Hora del evento — **hallazgo de datos (ya investigado, confirmar al ejecutar)**
- El modelo tiene `events.session_time` (T-106): una **hora única naive** (`time`, nullable), **NO** un
  rango inicio–fin. El ejemplo de la referencia ("06:15–07:15") es un **rango** que el modelo **no**
  soporta → renderizar **date • hora única** cuando hay `session_time`, y **solo la fecha** cuando no.
  Reportar en el PR que solo hay hora única (no rango).
- **Plumbing:** `EventCard` **no** recibe `session_time` hoy (solo `date`). Enhebrarlo como prop y desde las
  queries que alimentan las cards. **Ojo (mismo caveat que T-107):** las cards de listados vienen de
  `getUserEvents`/`getTopEvents`, cuyos `select` **no** incluyen `session_time` (ni `state` — ver T-107) →
  añadir `session_time` a esos select + tipos (`EventSummary`/`TopEventCandidate`) para las superficies que
  usen card. Reusar `formatSessionTime`/`formatEventDate` (`src/lib/format-date.ts`) para el render.

## Criterio de aceptación (Definition of Done)
- [ ] Tarjeta = contenedor redondeado: portada arriba (top redondeado, ~16:10 `object-cover`), sección de
      info abajo.
- [ ] Indicador de tipo de evento movido a arriba-izquierda de la portada (sin chocar con el dropdown owner).
- [ ] Quitado el icono "like" de abajo-derecha. Dos iconos a la derecha del título — share + corazón —
      **reusando** `event-share-button`/`event-save-button` del detalle. El corazón muestra estado toggle y
      es solo-autenticado (mismo comportamiento que el detalle); share reusa el componente existente.
- [ ] Orden de info: título (con share + corazón) → ubicación (más bold/grande, sin pin, bandera al final)
      → fecha + hora en una línea → fotógrafo en sección con divisor (avatar + link a perfil).
- [ ] La bandera se muestra cuando hay país estructurado mapeable; si no, se omite limpiamente y el gap se
      reporta (sin parseo frágil de texto libre).
- [ ] La hora se muestra cuando existe (`session_time`, hora única); cuando falta, la card muestra solo la
      fecha limpiamente (sin slot vacío).
- [ ] El layout se ve bien en todas las listas donde aparece la card (landing/home, explore de talento,
      cualquier listado) y en mobile + desktop.
- [ ] Sin regresión en el click-through de la card (abrir el evento), share, favoritos, ni link del
      fotógrafo.
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: la card ya no renderiza el pin de
      ubicación ni el saveSlot bottom-right; renderiza el corazón `EventSaveButton` en la línea del título;
      con `session_time` muestra date•hora, sin ella solo la fecha).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Archivo principal:** `src/components/event-card.tsx` (+ sus ~8 call sites que le pasan props:
  `featured-events.tsx`, `event-grid.tsx` (talento), `events/page.tsx` (fotógrafo),
  `recent-events-row.tsx`, `saved-events-grid.tsx`, `photographer-public-profile.tsx`,
  `pending-invitations-panel.tsx`). Reusar helpers existentes: `formatEventLocation`,
  `formatEventDate`/`formatSessionTime`, `getActivityIcon`.
- **Distinción explícita (constraint del usuario):** el corazón de la card (save por-evento, toggle) es
  **el mismo sistema saved-events** que el detalle y "Save event" — **NO** crear un mecanismo paralelo. Es
  **distinto** del icono de favoritos del **header** (navegación a la página de favoritos) que introduce
  **T-118** — ambos coexisten; que no se vean confusos.
- **Solape a coordinar:**
  - **T-118** (rediseño landing) también renderiza `EventCard` y añade el heart de favoritos al header. Y
    reemplaza `FeaturedEvents` por un grid paginado. Coordinar orden/merge (mismo componente/superficies).
  - **T-107** ya añadió `state`/`country` al `EventCard` (display de ubicación) — este ticket construye
    sobre eso (bandera desde `country`).
- **Flag:** sin deps pesadas — emoji flags o una lib CSS liviana (flag-icons) solo para banderas; el resto
  con Shadcn existente. Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-card-redesign`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
