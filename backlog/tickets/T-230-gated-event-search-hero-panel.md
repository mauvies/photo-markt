# T-230 · El estado previo a la búsqueda de un evento con reveal gate se ve vacío

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (solo UI/copy; no toca pagos, BD, auth — pero **no debe aflojar el gate**, ver Notas)
- **Blockers:** ninguno
- **Rama:** `design/gated-event-search-hero-panel`  (tipo = design)
- **OpenSpec change:** —  (cambio de presentación en dos superficies + copy)
- **PR:** —

## Requerimiento

Cuando las fotos del evento están restringidas para que solo se muestren mediante reconocimiento
facial, hoy **sí** se muestra un mensaje y se entiende, pero **la página queda vacía**. El usuario
quiere que ese mensaje llame más la atención — propone una caja con borde, quizá ocupando todo el
ancho y alto de la pantalla — y pide **buscar las prácticas estándar de la industria** para este tipo
de pantalla y resolverlo de la mejor forma, no necesariamente al pie de la letra.

**Referencia aportada por el usuario (Fotop):** un **único panel/tarjeta con borde** que contiene todo:
título grande ("Busque sus fotos"), descripción de por qué la galería es privada, un separador, y
**dentro del mismo panel** la fila de búsqueda facial (icono + texto + enlace de ayuda "Cómo enviar una
selfie de tu rostro" + botón primario destacado "Buscar mis fotos"), más una nota de privacidad al pie.

## Diagnóstico (verificado en el código)

El vacío no es falta de mensaje: es que **el propósito entero de la pantalla está partido en dos piezas
débiles**, y ninguna ancla la vista.

- La ranura de la galería renderiza **una sola línea gris**:
  `src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx:790-797` →
  `<div className="py-12 text-center"><p className="text-muted-foreground">{emptyText}</p></div>`,
  con `events.galleryGatedEmpty` ("…Take a selfie **above** to find yours." / "Sácate una selfie
  **arriba**…"). Un texto que le pide al usuario mirar *hacia arriba* es la señal de que el CTA está en
  el sitio equivocado.
- El CTA real vive en un componente **aparte y encima**: `FindMyPhotosBanner`
  (`src/components/event-gallery-with-face-search.tsx:183`).
- La superficie espejo del dashboard de talento repite el mismo patrón de párrafo mudo:
  `src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx:875` y `:881`.
- **Incoherencia añadida:** los estados hermanos ya tienen una forma mejor — `GatedFaceSearchNotice`
  y `PhotosEmptyState` usan icono grande + título `text-2xl` + descripción. O sea que hoy un evento
  gated puede renderizar **tres pesos visuales distintos** según el estado (buscable → párrafo mudo;
  procesando / no disponible → estado con icono y título).

## Criterio de aceptación (Definition of Done)

- [ ] En un evento con reveal gate y **sin búsqueda hecha**, la zona de la galería muestra un panel
      destacado (no un párrafo suelto) con título, explicación de por qué la galería no es navegable
      y **el CTA de búsqueda facial dentro del propio panel** — sin texto que remita a "arriba"
- [ ] Los **tres** estados previos a la búsqueda comparten el mismo peso visual: buscable,
      `processing` y `unavailable` (`resolveGatedFaceSearchNotice`) — no se arregla uno y quedan dos
      mudos
- [ ] Mismo resultado en las **dos** superficies: página pública `/events/[shareCode]` y vista de
      evento del dashboard de talento (CLAUDE.md exige que estén cableadas simétricamente)
- [ ] Un evento **no** gated no cambia: sigue navegando su galería con el banner de búsqueda donde
      está hoy
- [ ] Tras una búsqueda con match, el panel deja paso a los resultados como hasta ahora
- [ ] Strings nuevos/reescritos en `en.json` **y** `es.json` (incluido reemplazar el "arriba" de
      `events.galleryGatedEmpty`)
- [ ] Test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Sobre "todo el ancho y alto de la pantalla":** de acuerdo con el diagnóstico, con matiz en la
solución. El patrón estándar para un *gated empty state* (lo que hacen Fotop, SmugMug, Pixieset y las
pantallas de "search to unlock") es una **tarjeta centrada con borde y padding generoso**, con una
altura mínima para que no se vea delgada — **no** un bloque a pantalla completa: a `100vh` el
contenido queda flotando en el centro con enormes vacíos arriba y abajo, y en móvil empuja fuera de la
vista el título y los datos del evento. Recomendación a validar en el PR: panel a ancho de contenedor,
`min-height` moderada, jerarquía título → descripción → **un solo CTA primario inequívoco** →
nota de privacidad en `text-xs`. Merece la pena invocar el skill `frontend-design` al ejecutarlo.

**Decisión de alcance a tomar (declararla en el PR):** si para eventos gated el `FindMyPhotosBanner`
se **mueve dentro** del panel (como en la referencia) o se mantiene fuera y el panel solo lo duplica
visualmente. Mover es lo que elimina de raíz el "mira arriba"; hay que comprobar que no rompe la
composición de `EventGalleryWithFaceSearch` para el caso no-gated, que comparte el mismo componente.

⚠️ **No aflojar el gate (T-177).** La propiedad de seguridad es que a un visitante sin match **no le
llegan IDs ni URLs de fotos**. Este ticket es presentación: el panel no puede filtrar miniaturas,
conteos por foto ni nada derivado de las fotos concretas. El total del evento **sí** se muestra ya
junto a la cabecera cuando está gated (es deliberado, invita a buscar) y puede reutilizarse en el
panel.

**Copy:** hay claves ya existentes que probablemente se reaprovechan o reescriben —
`events.galleryGatedEmpty` (`en.json:191`) y `aiSearch.gatedNotice.*` (`en.json:1527`). Si el panel
gana un título propio hacen falta claves nuevas en ambos diccionarios.

**Prioridad P2:** no hay dinero, datos ni seguridad en juego y el flujo funciona (el mensaje se ve y el
botón existe), así que no es P1. Pero va arriba del grupo P2 porque en un evento con reveal gate
**esta pantalla es el producto**: si el visitante no busca, no ve nada y no compra nada.

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
