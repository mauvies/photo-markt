# T-035 · Consolidar el flujo de backlog/tickets en un solo directorio

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `chore/consolidate-backlog-workflow`
- **OpenSpec change:** —  (reorg mecánico de archivos + actualizar referencias; sin BD/pagos/auth)
- **PR:** #88

## Requerimiento
Hoy todo lo relacionado con tickets/backlog/flujo está **disperso**: `BACKLOG.md` en la raíz, `tickets/` en la
raíz, `scripts/run-backlog.sh`, las skills en `.claude/commands/`, y la doc del flujo en `CLAUDE.md`. El usuario
quiere consolidarlo en **un solo directorio** para que sea de fácil acceso. Además, **los tickets `done` nunca se
sacan de `tickets/`** → se acumulan junto a los activos (T-002…T-027 siguen ahí).

## Estado actual (verificado) — dónde vive cada pieza
- `BACKLOG.md` (raíz) — cola priorizada (tabla) + sección "Archivo (done)".
- `tickets/` (raíz) — `TEMPLATE.md` + `T-XXX-*.md` (activos **y** done mezclados).
- `scripts/run-backlog.sh` — hace `grep -qE '\| todo \|' BACKLOG.md`.
- `.claude/commands/ticket.md` — referencia `BACKLOG.md`, `tickets/T-XXX-…`, `tickets/TEMPLATE.md`.
- `.claude/commands/work-next.md` — referencia `BACKLOG.md`, `tickets/T-XXX-*.md`.
- `CLAUDE.md` (sección "Backlog workflow") — referencia `BACKLOG.md`, `tickets/`, `scripts/run-backlog.sh`.
- **Restricción:** las definiciones de slash-commands **deben** quedarse en `.claude/commands/` (lo exige Claude
  Code). No se pueden meter dentro del nuevo directorio; solo se actualizan sus rutas.

## Estructura propuesta (recomendada — ajustable al ejecutar)
```
backlog/
  README.md        # doc única del flujo (consolida el preámbulo de BACKLOG.md + la sección de CLAUDE.md)
  BACKLOG.md       # la cola: tabla priorizada + lista de Archivo  (conserva el nombre, ahora bajo backlog/)
  TEMPLATE.md      # plantilla de ticket (movida desde tickets/)
  tickets/         # tickets activos (T-XXX-*.md)
    done/          # tickets completados, movidos aquí al archivarse (declutter)
```
- Alternativa de naming: `backlog/queue.md` en vez de `backlog/BACKLOG.md`. Decidir al ejecutar; lo importante es
  **un solo dir** + **separar done de activos**.

## Criterio de aceptación (Definition of Done)
- [ ] Crear `backlog/` y mover ahí `BACKLOG.md` + `tickets/` + `TEMPLATE.md` con **`git mv`** (preservar historial)
- [ ] **Separar done:** mover los tickets ya `done` a `backlog/tickets/done/`; `backlog/tickets/` queda solo con activos
- [ ] `backlog/README.md` con el flujo completo en un sitio (capturar `/ticket` y `/work-next`, prioridades,
      estados, regla anti-conflicto, dónde van los done)
- [ ] **Actualizar TODAS las referencias de ruta** (sin romper el flujo):
  - [ ] `.claude/commands/ticket.md` → nuevas rutas (`backlog/BACKLOG.md`, `backlog/tickets/`, `backlog/TEMPLATE.md`)
  - [ ] `.claude/commands/work-next.md` → nuevas rutas (incl. "mover a `done/` al archivar")
  - [ ] `scripts/run-backlog.sh` → `grep` apunta a la nueva ruta del backlog
  - [ ] `CLAUDE.md` sección "Backlog workflow" → nuevas rutas (o apuntar a `backlog/README.md` como fuente)
- [ ] `grep -rn "tickets/\|BACKLOG.md"` no deja referencias colgando a las rutas viejas (fuera de `done/` histórico)
- [ ] `scripts/run-backlog.sh` sigue detectando `todo` correctamente tras el cambio (probar el grep)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (no debería tocar código de app; verificar que ningún test referencia las rutas)

## Notas
- **Es self-referential:** este ticket reescribe la ubicación del propio `BACKLOG.md` y de `work-next.md`. Al
  ejecutarlo con `/work-next`, el `doing`/`done` y el archivado deben usar las **rutas nuevas** una vez movidas.
- **Ejecutar AISLADO** (como T-019): toca la estructura de `BACKLOG.md`, así que cualquier otro ticket en vuelo que
  marque done/doing en `BACKLOG.md` choca. Correr con el resto de la cola mergeada.
- Es DX interno (no toca producto) → P2 porque el usuario lo pidió y reduce fricción en **cada** ticket futuro;
  si se prefiere priorizar lo de lanzamiento, bajar a P3 sin problema.
- Posibles extras (opcionales, decidir al ejecutar): un índice/orden simple, o un script que valide IDs/estados.
  No sobre-ingeniar: el core es consolidar + separar done.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/consolidate-backlog-workflow`.
2. Reorg mecánico → implementar directo (sin OpenSpec).
3. `git mv` de archivos + crear `done/` + README + actualizar las 4 referencias de ruta.
4. `pnpm typecheck && pnpm lint && pnpm test` + probar `run-backlog.sh` (grep).
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin chore/consolidate-backlog-workflow`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar `done`, mover el ticket a `backlog/tickets/done/` y registrar el PR en el backlog (rutas nuevas).
