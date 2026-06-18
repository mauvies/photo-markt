# T-004 · Mantener altura + empty state en tabs de eventos destacados (home)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/featured-events-empty-tab`
- **OpenSpec change:** —  (fix de UI acotado)
- **PR:** #58

## Requerimiento
En la home, sección de eventos destacados, al cambiar entre los tabs (eventos próximos / finalizados),
si un tab no tiene eventos la sección se encoge verticalmente y todo el contenido de abajo da un salto.
Debe: (1) mostrar un mensaje de "no hay eventos" apropiado, y (2) mantener la altura de la sección
para que el contenido inferior no salte. Observado en mobile; verificar también en desktop.

## Criterio de aceptación (Definition of Done)
- [ ] Tab sin eventos muestra un empty state con mensaje apropiado (no queda vacío)
- [ ] La sección mantiene una altura mínima estable al cambiar de tab → el contenido de abajo no salta (mobile y desktop)
- [ ] Tab con eventos sigue renderizando igual que antes
- [ ] Mensaje del empty state en `en.json` y `es.json`
- [ ] Test de regresión que cubra el render del empty state
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Componente probable: sección "featured/top events" de la home (ver `feature/home-top-events` en CLAUDE.md).
- Fix de layout: `min-h` en el contenedor de los tabs (alinear con la altura del estado con eventos) + empty state.
- Hay strings visibles nuevos → tocar ambos diccionarios.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/featured-events-empty-tab`.
2. Fix acotado → implementar directo (sin OpenSpec).
3. Implementar + test de regresión del empty state.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin fix/featured-events-empty-tab`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
