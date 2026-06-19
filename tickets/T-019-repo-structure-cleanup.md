# T-019 · Reorganizar la raíz del repo para navegación humana

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `chore/repo-structure-cleanup`
- **OpenSpec change:** sí (toca tsconfig/build config y muchos archivos → cae en la política OpenSpec)
- **PR:** #76

## Requerimiento
La raíz del repo se está volviendo un desastre: carpetas de Next.js, código de servidor,
configs de build, configs de IA/tooling y docs están todas mezcladas y cuesta diferenciarlas
de un vistazo humano. El usuario quiere categorizar el contenido para que un humano navegue
y encuentre cada área fácilmente. (La IA navega bien igual; esto es puramente ergonomía humana.)

## Criterio de aceptación (Definition of Done)
- [ ] Código fuente agrupado bajo `src/` (convención oficial de Next.js): mover `app/`,
      `components/`, `hooks/`, `lib/`, `database/`, `dictionaries/` a `src/`.
- [ ] `tsconfig.json` (paths/`@/*`), `biome.json`, `vitest.config.ts`, `next.config.ts`,
      `postcss`/tailwind content globs y `proxy.ts`/middleware actualizados a las rutas nuevas.
- [ ] `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` en verde tras el move.
- [ ] Basura suelta limpiada: borrar `tailwing.config` (archivo vacío con typo); añadir
      `tsconfig.tsbuildinfo` y `.DS_Store` a `.gitignore` si no están.
- [ ] Una línea en `README.md`/`ARCHITECTURE.md` describiendo la estructura de carpetas.
- [ ] **Actualizar las rutas documentadas en `CLAUDE.md` y `ARCHITECTURE.md`** a `src/` (hay
      decenas hardcodeadas: `database/queries/`, `lib/...`, `app/[lang]/...`, `components/...`).
      Sin esto, los docs de contexto quedan mintiendo tras el move.

## Notas
**ponytail — recortar el alcance antes de mover nada.** La mayoría de archivos del root NO se
pueden mover: Next.js y el tooling los fijan ahí (`next.config.ts`, `tsconfig.json`,
`package.json`, `pnpm-lock.yaml`, `postcss.config.mjs`, `biome.json`, `components.json`,
`env.mjs`, `proxy.ts`/middleware, `vitest.config.ts`, dotfiles, `public/`). Pelear contra eso
es trabajo sin recompensa.

El único movimiento de alto valor y camino trillado es **adoptar el directorio `src/`** de
Next.js: agrupa las 6 carpetas de código fuente y deja en el root solo configs + docs + `public/`.
Eso ya reduce el ruido visual a la mitad con un cambio mecánico y reversible (mover + ajustar
path aliases). No inventar una jerarquía custom (`server/`, `ai/`, etc.) — rompe convenciones
que la IA y los devs nuevos esperan, y multiplica el riesgo del move sin mejorar la navegación.

Riesgo: el move toca imports en todo el repo (los alias `@/*` lo absorben si están bien), globs
de Biome/Vitest, y `content` de Tailwind. Hacerlo en un solo commit grande con los 5 checks en
verde. CLAUDE.md exige que `proxy.ts` sea el middleware de Next — verificar que sigue resolviendo
tras el move (Next busca middleware en root o `src/`).

Decisión cerrada (2026-06-19): se va con `src/` (convención Next). No jerarquía custom.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/repo-structure-cleanup`.
2. `/opsx:propose` para generar el change (toca build config + muchos archivos).
3. Implementar (mover a `src/`, ajustar configs) + verificar que no hay regresión.
4. `pnpm typecheck && pnpm lint && pnpm test` (y `pnpm build` por el riesgo del move).
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin chore/repo-structure-cleanup`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
9. `/opsx:archive` del change.
