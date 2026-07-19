# T-160 · Actualizar TypeScript 6 → 7 (nativo) cuando Next lo soporte

- **Prioridad:** P3
- **Estado:** blocked
- **Blockers:** Next estable sin soporte de TS 7 (verificado en 16.2.10, el latest estable a 2026-07-19)
- **Rama:** `chore/typescript-7-native`  (tipo = chore)
- **OpenSpec change:** —  (tooling de tipos, sin cambio de comportamiento)
- **PR:** —

## Requerimiento
Follow-up de T-153, que subió `typescript` 5.9.3 → **6.0.3** (el bridge major que impone las
deprecations de TS 7) y dejó el salto a **7.x (reescritura nativa en Go)** verificado-bloqueado:

**Evidencia del bloqueo (T-153, 2026-07-19):** con `typescript@7.0.2` instalado, `tsc --noEmit`
y Biome pasan, pero **`pnpm build` falla** — la integración de type-checking de `next build`
(Next 16.2.10) carga la API JS del paquete `typescript` programáticamente; el paquete nativo 7.x
no expone esa superficie, Next concluye "TypeScript no está instalado", intenta reinstalarlo
(no-op) y el build worker crashea (`The "id" argument must be of type string. Received undefined`).
No hay Next estable más nuevo: 16.2.10 **es** el latest; 16.3 (canary/preview) sería el primer
candidato a traer soporte.

## Criterio de aceptación (Definition of Done)
- [ ] Re-verificar al bumpear Next a una versión cuyo changelog/release notes mencione soporte
      de TS 7 / tsgo (16.3+): instalar `typescript@7.x` y correr el gauntlet completo.
- [ ] `pnpm build` (producción) + `pnpm typecheck` + `pnpm lint` + `pnpm test` en verde bajo 7.x.
- [ ] Sin cambios de comportamiento; sin nuevos `any`.

## Notas
- El tsconfig ya quedó listo para 6+/7 en T-153 (`"types": ["node", "google.maps"]` — TS 6 dejó
  de auto-incluir paquetes @types con punto en el nombre).
- Tripwire natural: el próximo bump de Next (patch/minor) es el momento de re-probar 7.x — no
  antes (nada que hacer hasta entonces).
- Changelog TS: https://github.com/microsoft/TypeScript/releases

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
