# T-020 · Renombrar "picdemi" → "photo-markt" en todo el repo

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/rename-picdemi-to-photo-markt`
- **OpenSpec change:** — (rename mecánico, sin diseño que capturar)
- **PR:** —

## Requerimiento
El nombre real de la app es "photo-markt", pero el repo/directorio local todavía se llama
`picdemi` y quedan referencias a esa palabra. El usuario quiere que el repo se llame photo-markt
y que toda instancia de "picdemi" pase a "photo-markt".

## Criterio de aceptación (Definition of Done)
- [ ] Renombrar las 2 claves de `localStorage` en `app/[lang]/.../events/new/wizard.tsx`
      (`picdemi_event_wizard_draft`, `picdemi_event_wizard_had_files`) → prefijo **`photo-markt_`**
      para alinear con la clave ya existente `photo-markt_guest_cart`.
- [ ] `grep -ri picdemi` sobre el código vivo (sin `node_modules/.git/.next/coverage` ni archivos
      de OpenSpec archivados) devuelve 0 resultados.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Documentar fuera del PR el rename del directorio local (es acción manual, ver Notas).

## Notas
**Lo que YA está hecho (no es parte del ticket):** el repo de GitHub ya es `mauvies2/photo-markt`,
el remote local apunta ahí, y `package.json` se llama `photomarkt` (no contiene "picdemi"). El
footprint real de "picdemi" son solo 3 archivos.

**ponytail — 3 decisiones, no un find-and-replace ciego:**

1. **Claves de `localStorage` (wizard.tsx) — cambio con efecto colateral.** Renombrar la clave
   huérfana cualquier borrador de evento en curso de un usuario (su draft viejo queda bajo la clave
   `picdemi_*` y nunca se lee). Son claves internas invisibles, así que el coste es bajo, pero
   decidir explícito: o (a) aceptar el huérfano (lo más lazy; un borrador a medias se pierde) o
   (b) leer la clave vieja una vez y migrarla. Recomiendo (a) salvo que te importe ese borrador.

2. **OpenSpec archivados — NO tocar.** Las 2 referencias restantes
   (`openspec/changes/archive/2026-06-16-.../workflow.mjs` y `APPLY_PROMPT.md`) son la ruta absoluta
   `/Users/mauricio/code/picdemi` en un registro histórico congelado. Era correcta en su momento;
   reescribir historia es churn sin valor. Por eso el criterio del grep excluye OpenSpec archivado.

3. **Rename del directorio local — fuera del PR.** Renombrar `/Users/mauricio/code/picdemi` →
   `.../photo-markt` es un `mv` + reabrir el editor, no entra en un commit/PR. Tras moverlo,
   `tsconfig.tsbuildinfo` y `.next/` (caches con rutas absolutas) se regeneran solos en el próximo
   build. Es lo único que de verdad "renombra el repo" para el humano; el resto es cosmético.

Opcional adyacente (fuera de alcance): `package.json` dice `photomarkt`, no `photo-markt` —
inconsistente con el slug, pero no es "picdemi", así que no lo incluyo salvo que lo pidas.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull --ff-only` → crear rama `chore/rename-picdemi-to-photo-markt`.
2. Sin OpenSpec (rename mecánico).
3. Renombrar las 2 claves de localStorage; verificar con `grep -ri picdemi` (excluyendo lo de arriba).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin chore/rename-picdemi-to-photo-markt`.
7. `gh pr create --draft --base main` (título/cuerpo en inglés).
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
9. (Aparte del PR) `mv` del directorio local cuando quieras.
