# Backlog & flujo de tickets

Todo el trabajo se rastrea aquí, en `backlog/`: un solo directorio para la cola priorizada, la
plantilla, los tickets activos y el archivo de los completados.

## Estructura

```
backlog/
  README.md          # este archivo — el flujo completo en un sitio
  BACKLOG.md         # la cola priorizada (tabla) + lista de Archivo (done)
  DECISIONS.md       # el porqué de las reglas de CLAUDE.md (historia de incidentes, por ticket)
  TEMPLATE.md        # plantilla para tickets nuevos
  tickets/           # tickets activos (todo / blocked / doing)
    T-XXX-<slug>.md
    done/            # tickets terminados (done / descartados), movidos al archivarse
```

> Las definiciones de los slash-commands (`/ticket`, `/work-next`) viven en `.claude/commands/`
> (lo exige Claude Code) — no pueden moverse aquí; solo apuntan a estas rutas.

## Comandos del flujo

- `/ticket <req>` — captura un requerimiento como ticket y lo prioriza en `backlog/BACKLOG.md`
  (no escribe código). Crea `backlog/tickets/T-XXX-<slug>.md` a partir de `backlog/TEMPLATE.md`.
- `/work-next [T-ID]` — ejecuta el ticket de más arriba sin blockers de punta a punta:
  rama → (OpenSpec si toca BD/migraciones, auth/seguridad, pagos o es ambiguo) → test de regresión →
  `pnpm typecheck`/`lint`/`test` → commit (Conventional Commits, **sin `Co-Authored-By`**) → push →
  draft PR → archivar ticket.
- `scripts/run-backlog.sh [n]` — repite `/work-next` en serie hasta que no queden tickets `todo`
  (detecta los `todo` con un `grep` sobre `backlog/BACKLOG.md`).

**Una rama = un ticket = un draft PR.**

## Prioridades y estados

- **Prioridad:** `P0` urgente · `P1` alta · `P2` normal · `P3` algún día.
- **Estado:** `todo` · `blocked` · `doing` · `done` (al terminar se archiva).
- **Dep:** ejecutar después de ese ticket (mismo archivo/área o dependencia lógica). Sin Dep = independiente.

`backlog/BACKLOG.md` ordena la cola por **orden de ejecución** (`#`): se ejecuta de arriba hacia
abajo, respetando prioridad y dependencias, de modo que ningún ticket bloquea al siguiente si se
ejecutan en este orden.

## Dónde van los tickets terminados

Al archivar un ticket (último paso de `/work-next`):

1. Marca su estado `done` y muévelo de la tabla a la sección **Archivo (done)** de
   `backlog/BACKLOG.md`, anotando el nº de PR.
2. Mueve el archivo `backlog/tickets/T-XXX-*.md` a `backlog/tickets/done/` para que
   `backlog/tickets/` quede solo con tickets activos.

Los tickets descartados/revertidos también se mueven a `backlog/tickets/done/` y se anotan en la
sección **Descartados / revertidos** de `backlog/BACKLOG.md`.

## Regla anti-conflicto

Mergea (o rebasa) cada PR antes de arrancar el siguiente. Varios tickets editan los mismos archivos
(`en.json`/`es.json`, componentes compartidos); en serie con merge previo no hay conflicto. El loop
`scripts/run-backlog.sh` ya va en serie — respétalo; no lances ramas en paralelo sobre el mismo cluster.
