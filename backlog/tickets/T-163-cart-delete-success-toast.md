# T-163 · El borrado del carrito muestra toast de éxito (debería ser silencioso; solo el error debe notificar)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-delete-silent-success`  (tipo = fix)
- **OpenSpec change:** —  (UX/toast puro, no toca pagos/BD/auth)
- **PR:** —

## Requerimiento (reporte del usuario)
> Al borrar ítems del carrito salen **notificaciones para las acciones exitosas** de borrado, cuando
> **no deberían aparecer** — solo debería notificar **cuando el borrado no se ejecuta con éxito**.

## Causa (verificada en código)
`src/app/[lang]/dashboard/talent/cart/cart-content.tsx`:
- `handleRemove` (línea ~182): `toast.success(t('removedFromCart'))` en cada borrado exitoso.
- `handleClearCart` (línea ~213): `toast.success(t('cartCleared'))` al vaciar con éxito.

El **éxito debería ser silencioso** — la UI optimista ya quita el ítem al instante, así que el toast
de éxito es ruido redundante. Solo las ramas de **error** (`toast.error(...)`) deben notificar. Es la
misma convención que **T-146** (borrado optimista de fotos del fotógrafo: "éxito silencioso, solo
toast en fallo").

## Criterio de aceptación (Definition of Done)
- [ ] Quitar los `toast.success` de `handleRemove` y `handleClearCart` — el borrado exitoso (single y
      "clear") es **silencioso**; la UI optimista es el único feedback de éxito.
- [ ] Los `toast.error` de las ramas de fallo se **conservan** (rollback + notificación al usuario).
- [ ] Conservar el toast **informativo** de auto-heal (`itemsUnavailableRemoved`, T-117) — ese no es
      un "éxito de la acción del usuario" sino un aviso de que se removieron ítems no comprables;
      confirmar que se mantiene.
- [ ] Si quedan strings (`removedFromCart`, `cartCleared`) sin uso tras quitar los toasts, evaluar
      dejarlos (por si se reusan) o limpiarlos de `en.json`/`es.json` — decisión menor al ejecutar.
- [ ] test de regresión: en borrado exitoso **no** se llama `toast.success`; en fallo **sí**
      `toast.error` (mockear `sonner`). Falla antes / pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P3** — es UX/pulido (ruido de notificaciones), sin impacto funcional ni de datos.
- Relacionado con **T-162** solo por tocar el **mismo archivo** (`cart-content.tsx`, mismos handlers
  `handleRemove`/`handleClearCart`) — **coordinar el merge** con T-162 para evitar conflicto, o
  ejecutarlos contiguos (T-162 primero por prioridad, luego este sobre el mismo handler ya tocado).
- Solo UI/toast → sin `/code-review`, sin OpenSpec.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-delete-silent-success`.
2. Implementar directo (quitar `toast.success` de los borrados) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
