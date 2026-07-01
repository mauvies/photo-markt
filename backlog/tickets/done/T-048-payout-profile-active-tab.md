# T-048 · Tab activo incorrecto en `/settings/payout-profile` (marca "Perfil", debe ser "Pagos")

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/payout-profile-active-tab`
- **OpenSpec change:** —
- **PR:** #106

## Requerimiento
Al editar el perfil de cobros en `/dashboard/photographer/settings/payout-profile`, el tab
resaltado como activo es **"Perfil"** cuando debería ser **"Pagos"** (Payouts).

## Causa (ya localizada)
`src/components/settings/settings-shell.tsx:45`:
```js
const activeSlug = sections.find((s) => pathname === s.href)?.slug ?? sections[0]?.slug;
```
El match es por **igualdad exacta** de pathname. `/settings/payout-profile` no coincide con
ningún href de tab (`/profile`, `/billing`, `/payouts`, `/language`), así que `.find()`
devuelve `undefined` y cae al fallback `sections[0]` = **`profile`**. Además `payout-profile`
**no** cuelga de `/payouts/` (es ruta hermana), así que un `startsWith('/payouts')` tampoco lo
captaría solo.

## Criterio de aceptación (Definition of Done)
- [x] En `/settings/payout-profile` el tab activo es **Pagos** (`payouts`), no Perfil.
- [x] Las subpáginas de una sección resaltan su tab padre (p. ej. cualquier `/payouts/...`
      marca Pagos); no se cae al `sections[0]` para subrutas no exactas.
- [x] No rompe el resto de tabs (profile/billing/payouts/language) ni el shell de talent que
      reusa `SettingsShell`.
- [x] test de regresión del helper de "sección activa" (pathname → slug), incluyendo el caso
      `payout-profile → payouts`. Falla antes, pasa después.
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Considerar extraer la lógica de match a un helper puro testeable (`resolveActiveSlug(pathname, sections)`)
  con un mapa de subrutas → sección padre (`payout-profile` → `payouts`).
- `settings/layout.tsx` define las 4 secciones; `payout-profile` y `payouts` son subpáginas de la
  sección Pagos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose`; si no, implementar directo.
3. Implementar + test de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` a `main`.
8. Marcar `done`, mover a Archivo con nº de PR, y mover el ticket a `backlog/tickets/done/`.
9. Si hubo OpenSpec change, `/opsx:archive`.
