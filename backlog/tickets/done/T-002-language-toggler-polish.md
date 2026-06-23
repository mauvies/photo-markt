# T-002 · Pulir diseño del language toggler dropdown

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/language-toggler-polish`
- **OpenSpec change:** —  (cambio chico de UI, 1 archivo)
- **PR:** #70

## Requerimiento
En el dropdown del language toggler: bordes más redondeados para alinear con el estilo de la app,
banderitas de idioma un poco más pequeñas. Diseño general más fluido y más bonito.

## Criterio de aceptación (Definition of Done)
- [ ] Bordes del dropdown más redondeados, consistentes con el resto de la UI (mismo radio que otros popovers/cards)
- [ ] Banderitas reducidas de tamaño y bien alineadas con el texto
- [ ] Sin cambios funcionales (sigue cambiando idioma igual)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Componente probable: el language/locale toggler (buscar por "language" / "locale" / banderas).
- Solo estilos (Tailwind/shadcn). No tocar lógica de i18n ni routing de `[lang]`.
- Sin strings visibles nuevos → no requiere tocar `en.json` / `es.json`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/language-toggler-polish`.
2. Cambio chico de UI → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/language-toggler-polish`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
