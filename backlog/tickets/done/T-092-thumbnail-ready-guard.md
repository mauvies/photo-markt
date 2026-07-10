# T-092 · [Inngest/Perf] Guard `thumbnail_status='ready'` en el re-horneado de thumbnails (evita re-bake + churn del CDN)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `perf/thumbnail-ready-guard`  (tipo = perf → usar prefijo `fix/` si se prefiere consistencia)
- **OpenSpec change:** —
- **PR:** #152
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-14**, ítem #9 del plan)

## Requerimiento
`generate-photo-thumbnails` nunca chequea `thumbnail_status` en `load-context`
(`generate-photo-thumbnails.ts:66-75`): cualquier re-emisión de `photo.processed` (re-index de
fotos no indexadas, disable→re-enable de AI) re-descarga el original, re-corre
watermark+blur+2×resize+2×upload **y bumpea `thumb_version`**, busteando sin necesidad la entrada
inmutable del CDN (interactúa con T-078: correcto pero desperdicia hit rate). Añadir early-return
cuando el thumbnail ya está `ready`, con un flag explícito de `force` para los re-bakes genuinos
(p.ej. cuando el re-index cambió las caras y el blur debe actualizarse).

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** los tests de integración existentes del worker
      (`test/integration/inngest/generate-photo-thumbnails.test.ts` — incl. idempotencia y el
      bump de `thumb_version` de T-078) en verde **antes** del cambio
- [ ] Con `thumbnail_status='ready'` y sin `force`, el worker hace skip sin descargar ni subir
      nada y **sin** bumpear `thumb_version`
- [ ] El caso `force` (re-bake genuino: caras nuevas indexadas) sigue horneando y bumpeando —
      **no romper el fix de T-078**: si el blur puede haber cambiado, el re-bake debe ocurrir
- [ ] test de regresión que falla antes y pasa después (re-emisión sobre ready → skip, versión
      intacta)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Decisión de diseño clave al ejecutar:** cuándo forzar. El flujo T-078 (habilitar IA después →
  re-index → thumbnails deben re-hornearse CON blur) depende de que el re-bake ocurra. Propuesta:
  `photo.processed` lleva un hint (`facesChanged`/`force`) que `index-photo-faces` setea cuando
  persistió caras nuevas; skip solo cuando no hay cambio. Sin ese hint, un guard ingenuo
  **reintroduciría el hueco de T-078** — el test de regresión de T-078 debe seguir pasando.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/thumbnail-ready-guard`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
