# T-242 · El header y la barra de selección usan fondos distintos: el contenido se ve pasar por debajo de forma incoherente

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (solo presentación)
- **Blockers:** ninguno
- **Rama:** `design/unify-sticky-bar-backdrop`  (tipo = design)
- **OpenSpec change:** —  (cambio visual acotado)
- **PR:** —

## Requerimiento

Reportado por el usuario: el **nav** y la **barra de selección** tienen efectos de fondo distintos, y
se nota feo al hacer scroll cuando el contenido empieza a pasar por debajo de ambas — el nav se ve
«un poco transparentoso» y la barra de selección se ve **blanco totalmente opaco**.

**Es literal, y las dos recetas están a la vista:**

| Barra | Fichero | Clases |
|---|---|---|
| Header superior | `src/components/header-shell.tsx:21` | `bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80` |
| Barra de selección | `src/components/photo-selection-toolbar.tsx:84` | `bg-background/95 backdrop-blur-sm` |
| Bottom nav (móvil) | `bottom-nav.tsx:34` · `photographer-bottom-nav.tsx:99` | `bg-background/95 backdrop-blur-sm` |

O sea: **`/80` con blur completo frente a `/95` con `blur-sm`**. A 95 % de opacidad el fondo es
prácticamente sólido, así que las dos barras no pueden coincidir por mucho que se afinen los valores —
son dos decisiones distintas tomadas en sitios distintos. El header es además el único que declara el
fallback `supports-backdrop-filter:`, con lo que en un navegador sin `backdrop-filter` la divergencia
es todavía mayor.

## La decisión que hay que tomar (no está resuelta en la captura)

Unificar hacia **una** receta, pero hay una tensión real que explica por qué la barra de selección
acabó en `/95`: **se apoya sobre una rejilla de fotos**, y un fondo muy translúcido sobre imágenes
densas se come el contraste del texto y de los controles. El header, en cambio, suele tener debajo
contenido de página, mucho más plano.

Recomendación para ejecutar: **una sola fuente de verdad** (una utilidad compartida en `globals.css`
—donde ya hay precedente de utilidades propias fuera de `@layer`— o un componente/constante
reutilizado), y si la legibilidad sobre fotos exige más opacidad, entonces **sube también el header**.
Lo que no puede quedar es un valor por sitio. Si al implementarlo se ve que una sola receta no sirve
para ambos contextos, documentar en el PR por qué, con captura de los dos casos.

## Criterio de aceptación (Definition of Done)

- [ ] Header, barra de selección y bottom nav comparten **una sola** definición del fondo translúcido
      (opacidad + blur + fallback `supports-backdrop-filter`), no tres literales sueltos
- [ ] Al hacer scroll, el contenido que pasa por debajo del header y por debajo de la barra de
      selección se ve con el **mismo** tratamiento — verificado en la pantalla donde el usuario lo
      reportó (`dashboard/photographer/events/[id]`, con la rejilla de fotos detrás)
- [ ] El texto y los controles de la barra de selección siguen siendo legibles sobre una rejilla de
      fotos claras y oscuras (es la razón por la que hoy está a `/95` — no romperla al bajar opacidad)
- [ ] Coherente en **tema claro y oscuro** (el reporte es sobre el blanco, pero `bg-background` cambia)
- [ ] Cubre los cuatro sitios de uso de `PhotoSelectionToolbar` (`event-photo-album`,
      `pending-photos-tab` ×2, `photo-gallery`) — al vivir en el componente compartido debería salir
      gratis, pero hay que mirarlo porque cada vista le pasa su propio offset de sticky
- [ ] Sin regresiones de z-index: el header (`z-50`) sigue por encima de la barra (`z-30`)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Por qué P2:** es puramente visual y no bloquea nada, pero está en la pantalla de trabajo principal del
fotógrafo y lo reportó el usuario directamente; va con el resto de tickets visuales (T-229, T-230,
T-233) y no por debajo de ellos.

Sin solapamiento con ningún ticket en cola: T-233 toca el *aspect ratio* de la portada del event card y
T-230 el estado vacío de un evento con reveal gate; ninguno toca el chrome sticky.

Nota de alcance: `cookie-consent-banner.tsx:55` usa la misma receta `/95 + blur-sm` pero es una tarjeta
flotante, no chrome por el que pase el contenido al hacer scroll — queda **fuera** salvo que al
extraer la utilidad compartida entre gratis y sin cambio visual.

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
