# T-015 · Traducir y dejar lista para producción la página de comentarios (feedback)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/feedback-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado a 1 componente)
- **PR:** —

## Requerimiento
Igual que T-014 pero para la página de **comentarios / feedback**: traducir a español, completar, mejorar y
dejar lista para producción, coherente con el resto de la app y realmente útil.

## Estado actual (verificado)
- Componente: **`components/feedback-view.tsx`** (~653 líneas), **no usa i18n** → contenido hardcodeado.
- Rutas: `app/[lang]/dashboard/photographer/feedback` y `.../talent/feedback`. Server Action: `app/[lang]/actions/feedback.ts`.

## Criterio de aceptación (Definition of Done)
- [ ] Todo el texto visible cableado a i18n; nada hardcodeado
- [ ] Claves nuevas en `en.json` **y** `es.json`, traducción ES correcta y con el tono de la app
- [ ] Contenido completado/mejorado y coherente con el producto; variación por rol revisada si aplica
- [ ] El flujo de envío de feedback (`actions/feedback.ts`) sigue funcionando; mensajes de éxito/error traducidos
- [ ] Se ve bien en mobile y desktop, en `es` y `en`
- [ ] Test de regresión del Server Action de feedback si no existe
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Archivo grande (653 líneas): cablear i18n con cuidado, sin romper la lógica del formulario.
- Mismo patrón que T-014 (soporte); si se hacen juntos, reutilizar enfoque/claves comunes.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/feedback-page-i18n-production`.
2. Acotado → implementar directo (sin OpenSpec).
3. Implementar contenido + i18n + test del action.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/feedback-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
