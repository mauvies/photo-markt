# T-184 · Reveal gate deja el evento sin salida cuando no hay fotos indexadas (búsqueda facial no aparece)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/reveal-gate-dead-end`  (tipo = fix)
- **OpenSpec change:** —  (follow-up de robustez de T-177; decidir al ejecutar)
- **PR:** —

## Requerimiento (reporte del usuario)
> "Si **cierro la puerta** para que solo se puedan encontrar las fotos por reconocimiento facial, en `/en/dashboard/talent/events/marathon-paris-france-2026` **no aparece la sección para usar el reconocimiento facial**."

## Diagnóstico (verificado contra **staging** vía MCP)
Mismo evento que T-183 (`23245657-…`): `ai_matching_enabled=true` pero **`ai_matching_status='idle'`** y **`face_index_status='not_applicable'` en las 69 fotos** → **`indexed = 0`** (ninguna foto indexada en Rekognition).

La elegibilidad de la búsqueda facial en la vista de talento (`dashboard/talent/events/[id]/page.tsx:223-244`) exige **`getEventAiIndexingProgress(...).indexed > 0`** para poner `aiSearchEligible = true`. Con `indexed = 0`, la sección/banner de búsqueda facial **nunca se renderiza**.

**El problema de fondo (interacción con T-177):** con el **reveal gate encendido**, un evento gateado **no muestra ninguna foto** hasta que el visitante prueba un match facial — pero si la entrada de búsqueda facial está **oculta** (porque `indexed=0`), el visitante se queda **sin fotos y sin forma de buscarlas → callejón sin salida**. La feature se rompe en silencio: el evento queda completamente inaccesible.

**Dos causas compuestas:**
1. **AI "enabled" pero nada indexado** (`indexed=0`, status `idle`, todas `not_applicable`): AI se activó en el evento **después** de subir las fotos y el **backfill de indexado** (`backfillEventIndexing`) nunca corrió/completó (worker no ejecutado en staging, o el enable no disparó el fan-out). Comparte raíz de reliability del worker con T-183.
2. **Gap de diseño en T-177:** habilitar el reveal gate en un evento que **no es buscable por cara** (indexed=0, o indexing en curso, o `failed`) crea un dead-end en vez de un estado claro.

## Criterio de aceptación (Definition of Done)
- [ ] Un evento con **reveal gate ON** que **aún no es buscable por cara** (indexed=0 / indexing / failed) **no queda sin salida** en la vista de talento (y en la pública `/events/[shareCode]`). Elegir y aplicar el enfoque (ver Notas):
  - (a) **Bloquear/advertir al habilitar el gate** si el evento no tiene indexado listo (el toggle exige `ai_matching_status='ready'` o `indexed>0`), y/o
  - (b) **Renderizar un estado claro** cuando el gate está ON pero no hay búsqueda disponible: "las fotos se están procesando / búsqueda facial no disponible todavía" en lugar de ocultar la entrada y no mostrar nada.
- [ ] Cuando el gate está **ON** e indexing está **en curso**, el talento ve un estado "procesando" (no un vacío mudo). Cuando indexing **falló**, un estado claro (no dead-end).
- [ ] **No** cambia el comportamiento del caso **gate OFF** con `indexed=0`: ahí es correcto no mostrar búsqueda facial (el talento puede navegar las fotos approved normalmente).
- [ ] Se aborda (o se enlaza a T-183) la causa de fondo "AI enabled pero backfill nunca indexó" (status `idle` + todas `not_applicable`): el backfill de indexado debe correr/reconciliarse al habilitar AI en un evento con fotos existentes. Si se resuelve en T-183/T-099, dejarlo referenciado; si no, cubrirlo aquí.
- [ ] test de regresión que falla antes y pasa después: gate ON + `indexed=0` ⇒ la vista de talento muestra el estado "no disponible/procesando" (no un dead-end silencioso); gate ON + `indexed>0` ⇒ banner de búsqueda facial presente.
- [ ] strings nuevos (estado "procesando/no disponible") en `en.json` y `es.json`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Superficie:** `dashboard/talent/events/[id]/page.tsx` (`aiSearchEligible`, líneas ~219-244; y el bloque gated que decide qué renderizar cuando `gated`), la pública `events/[shareCode]/page.tsx` (misma predicado de elegibilidad — mantener paridad), `EventGalleryWithFaceSearch`/`FindMyPhotosBanner`, los toggles del reveal gate en wizard/edit (T-177), y `getEventAiIndexingProgress`/`getEventRekognitionState`.
- **Propiedad de seguridad de T-177 intacta:** este ticket **no** afloja el gate (no expone fotos sin match) — solo evita el dead-end mostrando un estado claro o impidiendo habilitar el gate cuando no hay búsqueda posible.
- **Relación:** T-177 (feature del reveal gate, PR #237) — esto es un follow-up de robustez. **T-183** cubre el otro síntoma del mismo evento (owner uploads en pending) y comparte la raíz de reliability del worker/backfill.
- **Ojo prod:** el reveal gate **no está aplicable en prod todavía** (columna `reveal_gate_enabled` ausente en prod — ver **T-185**), así que este dead-end hoy solo se reproduce en staging/local. Igual conviene arreglarlo antes de que el gate llegue a prod.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/reveal-gate-dead-end`.
2. Si aplica, `/opsx:propose`; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
