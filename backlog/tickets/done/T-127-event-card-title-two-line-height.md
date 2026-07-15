# T-127 · EventCard: reservar dos líneas para el título (altura de card consistente)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/event-card-title-two-line-height`  (tipo = fix)
- **OpenSpec change:** —  (UI de un solo componente, requerimiento claro)
- **PR:** #192

## Requerimiento
En el `EventCard` rediseñado (T-119, PR #180), el área del título **crece con el largo del título**:
un título de una línea ocupa una línea, uno largo ocupa dos. Como el bloque de título no reserva una
altura fija, las cards con título de dos líneas quedan **más altas** que las de una línea, y las filas de
info de abajo (ubicación + bandera, fecha + hora, sección del fotógrafo) **se desalinean** entre cards →
la grilla se ve despareja.

Reservar **siempre** la altura de **dos líneas** para el título, sin importar su largo:
- Títulos de una línea siguen renderizando **una** línea de texto, pero el espacio reservado es de dos →
  el contenido de abajo siempre arranca en la misma posición vertical.
- Títulos largos hacen wrap a **máximo dos líneas** y truncan con elipsis si exceden (`line-clamp-2` o
  equivalente) — un título muy largo nunca empuja la card más allá de dos líneas.
- El resto de la info sigue **igual y en el mismo orden**: ubicación (con bandera), fecha + hora, y
  fotógrafo en la sección inferior separada por divisor.

## Estado actual (verificado en el código)
- `src/components/event-card.tsx:366` — el título es
  `<h3 className="line-clamp-2 text-lg font-semibold leading-snug text-foreground">{name}</h3>`.
  Ya tiene `line-clamp-2` (cap + truncado a dos líneas), **pero no reserva altura**: un título de una
  línea colapsa a una y sube todo lo de abajo. Falta un `min-height` (o altura fija) equivalente a dos
  líneas de `text-lg`/`leading-snug`.
- El componente se usa en home/landing, explore de talento y cualquier listado de eventos — un solo
  archivo (`event-card.tsx`), así que el fix aplica a todas las superficies de una.

## Criterio de aceptación (Definition of Done)
- [ ] El área del título reserva una **altura fija de dos líneas** en todas las cards, sin importar el
      largo del título.
- [ ] Títulos de una línea renderizan una línea pero reservan el espacio de dos (la info de abajo arranca
      en la misma posición que en cards con título de dos líneas).
- [ ] Títulos de más de dos líneas hacen wrap a dos y truncan con elipsis — **nunca** más de dos líneas.
- [ ] Todas las cards de una grilla tienen **altura consistente**; ubicación, fecha y fotógrafo se alinean
      entre cards con títulos de 1 y de 2 líneas.
- [ ] Sin cambios al resto del contenido ni al orden de la card (indicador de tipo, iconos de acción del
      título, ubicación + bandera, fecha + hora, sección del fotógrafo).
- [ ] Verificado en layouts de grilla **mobile y desktop**, con mezcla de títulos cortos y largos.
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: el `<h3>` del título lleva la clase
      de altura fija de dos líneas + `line-clamp-2`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Enfoque CSS con el Tailwind existente — **sin libs nuevas**. Reservar el espacio de dos líneas aun con
  título de una: `min-h` que iguale dos líneas de `text-lg` + `leading-snug` (≈ 2 × 1.125rem × 1.375 ≈
  `min-h-[3.1rem]`), o una altura fija que combine limpio con `line-clamp-2` — la que renderice más
  consistente. No hardcodear un número frágil si hay una utilidad Tailwind más clara.
- Sin strings nuevos (no cambia copy). Sin `any`. Biome. **Sin otros cambios a la card.**
- Follow-up puntual del rediseño T-119 (PR #180) — no duplica ese ticket (ya archivado); solo fija la
  altura del título que quedó variable.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/event-card-title-two-line-height`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
