# T-233 · Alargar el event card: cambiar el aspect ratio del contenedor de la portada

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** normal  (CSS puro + tests que fijan la clase; ni pagos ni auth ni BD)
- **Blockers:** ninguno
- **Rama:** `design/event-card-cover-aspect`  (tipo = design)
- **OpenSpec change:** —  (cambio de una constante de estilo; no aplica)
- **PR:** #291 (junto con el otro ticket del cluster event card)

## Requerimiento (en palabras del usuario)
> Alargar más el event card, es decir modificar el radio de aspecto para que la foto de portada se
> aprecie mejor. Concretamente lo que realmente se debe modificar es **el radio de aspecto del
> container donde se muestra la foto de portada**.

## Dónde está hoy (verificado en código)
El ratio es **`aspect-[4/3]`** y está escrito a mano en **dos** sitios que deben moverse juntos:
- `src/components/event-card.tsx:289` — el contenedor real de la portada
  (`relative aspect-[4/3] w-full overflow-hidden bg-muted`), con el `<Image fill>` en `object-cover`.
- `src/components/event-card-skeleton.tsx:13` — el esqueleto de carga, que existe precisamente para
  reservar el mismo hueco.

**Si los dos se desincronizan hay CLS**: el esqueleto reserva una altura y la portada pinta otra, y el
event card es el elemento LCP de la home/explore (T-123/T-124). `events-explore-view-skeleton.tsx`
reusa `EventCardSkeleton`, así que hereda el valor — no hay un tercer sitio que tocar.

Además, **cinco archivos de test fijan la cadena literal `aspect-[4/3]`** y fallarán en rojo hasta
actualizarlos (lo cual es justo el test de regresión que pide el DoD):
`test/unit/components/event-grid.test.tsx:58`, `event-card-skeleton.test.tsx:14`,
`route-loading-skeletons.test.tsx:74,89,114` (y `:105`, que asserta lo contrario — que cierto skeleton
**no** lleva el ratio; ojo con no romper esa negativa).

## Valor propuesto y la contrapartida que hay que asumir a ojo
El contenedor es `object-cover`, así que **alargarlo recorta más los lados**: una portada apaisada
(lo que sale de cualquier cámara: 3/2 o 16/9) se ve **más grande en pantalla pero con menos encuadre**.
Esa es la contrapartida real del cambio y no se puede evitar con CSS — conviene mirarlo con portadas
reales antes de fijar el número.

- **Recomendado: `aspect-[1/1]`** (cuadrado). Sube la altura del cover un **33 %** sobre 4/3, recorta
  de forma simétrica y es el formato que usan los marketplaces de referencia (el repo ya sigue el
  patrón Airbnb en el buscador). Es el punto donde la portada gana presencia sin que un plano general
  de una carrera pierda el sujeto.
- **Alternativa más agresiva: `aspect-[4/5]`** (retrato, estilo Instagram) — máxima altura, pero
  recorta ~40 % del ancho de una foto 3/2; solo si al verlo el usuario quiere más.

Ejecutar con el recomendado; cambiarlo después es editar **una** constante, así que no bloquear por
esto.

## Criterio de aceptación (Definition of Done)
- [ ] El contenedor de la portada del event card usa el nuevo ratio y el **esqueleto reserva
      exactamente el mismo hueco** — verificado en el mismo cambio, no como follow-up.
- [ ] El ratio deja de estar duplicado a mano: se extrae a una **única constante compartida** con la
      clase Tailwind **literal completa** (p. ej. `EVENT_CARD_COVER_ASPECT = 'aspect-[1/1]'` en un
      módulo client-safe) que consumen tarjeta y esqueleto. ⚠️ Tailwind escanea literales en el
      fuente: la clase debe aparecer entera en el código, nunca construida por concatenación
      (`aspect-[${x}]` no genera CSS).
- [ ] Sin regresión de layout en **todas** las superficies que renderizan el card: explore de talento
      (`dashboard/talent/events/components/event-grid.tsx`), eventos del fotógrafo
      (`dashboard/photographer/events/page.tsx`), la fila horizontal del dashboard
      (`_components/recent-events-row.tsx` — comprobar que un cover más alto no rompe el scroller),
      perfil público (`photographer-public-profile.tsx`) y eventos guardados (`saved-events-grid.tsx`).
- [ ] **Sin CLS nuevo**: el esqueleto y la tarjeta coinciden en altura en móvil y escritorio; el card
      sin portada (fallback `bg-muted` / "imagen no disponible") también respeta el nuevo alto.
- [ ] El atributo `sizes` del `<Image>` (`event-card.tsx:300`) se revisa: sigue siendo correcto porque
      está expresado en anchos de viewport, pero un cover más alto **crece como elemento LCP** — dejar
      constancia de que se miró (premisa de T-123/T-124), sin exigir re-medición formal.
- [ ] Los **cinco** tests que fijan `aspect-[4/3]` se actualizan al nuevo valor, conservando el sentido
      de cada uno — incluida la aserción **negativa** de `route-loading-skeletons.test.tsx:105`.
- [ ] test de regresión: el assert de que **tarjeta y esqueleto comparten el mismo ratio** (hoy es una
      coincidencia mantenida a mano en dos archivos) — es lo que impide que el próximo cambio de
      diseño reintroduzca el CLS.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — es polish de diseño sin impacto funcional, pero el coste es casi nulo y cae sobre la
  superficie de descubrimiento principal del producto (home/explore). No sube más porque nadie está
  bloqueado; no baja a P3 porque el usuario lo pidió en firme y se cierra en una sesión corta.
- **No duplica a T-119** (rediseño del event card, done) ni a T-127 (título a dos líneas): aquellos
  fijaron la composición actual, este solo mueve el ratio del cover.
- **Solapa en archivo con T-229** (`event-card.tsx`, conteo de fotos) → ejecutar **después** de T-229
  para no cruzar diffs en el mismo componente.
- Relación con **T-232**: aquel hace *editable* la portada desde el tab de fotos; este cambia *cómo se
  ve*. Independientes, pero juntos son la misma queja de fondo — la portada importa y hoy está
  infraservida.
- Al ejecutar, mirar el resultado con portadas reales (apaisadas) antes de dar por bueno el número;
  si el recorte lateral se come el sujeto, quedarse en 1/1 y **no** ir a 4/5.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `design/event-card-cover-aspect`.
2. Extraer la constante compartida del ratio, aplicarla en tarjeta + esqueleto, actualizar los cinco
   tests que fijan `aspect-[4/3]` y añadir el assert de paridad tarjeta↔esqueleto.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
