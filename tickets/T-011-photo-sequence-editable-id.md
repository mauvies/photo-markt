# T-011 · Secuencia + identificador editable para fotos de un evento

- **Prioridad:** P2
- **Estado:** **descartado (revertido)** — se implementó (PR #66) y se revirtió por baja utilidad.
- **Blockers:** ninguno
- **Rama:** `feat/photo-sequence-editable-id` (revertida)
- **OpenSpec change:** `photo-event-code` (creado y luego revertido)
- **PR:** #66 (mergeado) + PR de revert

> **Por qué se revirtió:** como código interno del fotógrafo aporta poco — texto libre duplicable que
> no identifica de forma fiable, y el badge sobre la imagen no convencía. El identificador útil del
> dominio es el **dorsal/BIB buscable por el atleta** (de cara al talent, idealmente con OCR), que se
> alinea con el "BIB number recognition" ya anunciado en los planes. Si se retoma, plantear como ticket
> nuevo orientado a talent.

## Requerimiento
Poder identificar cada foto de un evento siguiendo una lógica conocida (numeración/nombre con orden), y
que el fotógrafo pueda **editar ese identificador** de las fotos que sube a un evento. Hoy no existe orden ni
identificador editable; otras apps similares sí lo tienen.

## Estado actual (verificado)
- Ya existe `photos.original_filename` (migración `20260519000001`) — guarda el nombre del archivo subido.
- **No existe** columna de orden/secuencia (`sort_order`/`position`) ni un label editable por el usuario.

## Propuesta de alcance (definir en `/opsx:propose`)
Capa 1 — **secuencia automática por evento**: número correlativo asignado al subir (orden de carga),
estable y visible. Capa 2 — **label/ID editable** opcional por foto que el fotógrafo puede sobrescribir.

## Criterio de aceptación (Definition of Done)
- [ ] Migración: columna de secuencia (p. ej. `sequence int` único por `event_id`) y/o `display_label text` editable
- [ ] Al subir fotos a un evento se asigna la secuencia automáticamente (orden de carga)
- [ ] El fotógrafo puede editar el label/ID de una foto desde el dashboard del evento
- [ ] El identificador se muestra en la galería del dashboard del fotógrafo (y donde tenga sentido)
- [ ] Queries nuevas en `/database/queries/photos.ts` (nada inline)
- [ ] Tests: asignación de secuencia al subir + edición del label (Server Action/query)
- [ ] Strings nuevos en `en.json` y `es.json`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas / preguntas abiertas (resolver en propose)
- ¿La secuencia es global por evento o por lote de subida? ¿Se reordena si se borran fotos? (sugerido: no reusar números, hueco permitido)
- ¿El label editable debe ser único por evento? ¿Validación de formato?
- ¿Visible solo para el fotógrafo o también para el talent/cliente?
- Considerar interacción con el feature flag de subida y con el indexado Inngest (no bloquear la subida por esto).
- Mutaciones vía Server Actions (no API routes), según convención del repo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/photo-sequence-editable-id`.
2. **`/opsx:propose`** (DB + queries + UI) y luego `/opsx:apply`.
3. Implementar migración + queries + UI + tests de regresión/feature.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/photo-sequence-editable-id`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR; `/opsx:archive`.
