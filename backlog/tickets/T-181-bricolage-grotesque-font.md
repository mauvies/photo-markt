# T-181 · Probar la font family Bricolage Grotesque

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/bricolage-grotesque-font`  (tipo = feat)
- **OpenSpec change:** —  (cambio acotado: `layout.tsx` + `globals.css`; innecesario)
- **PR:** —

## Requerimiento
Probar la tipografía **Bricolage Grotesque** en la app. Es un experimento de diseño ("me gustaría probar") — evaluar cómo se ve antes de decidir adoptarla de forma permanente.

## Criterio de aceptación (Definition of Done)
- [ ] Bricolage Grotesque cargada vía `next/font/google` en `src/app/layout.tsx` (está disponible en Google Fonts como variable font), expuesta como CSS var (p. ej. `--font-bricolage`) igual que Inter/Inter Tight hoy.
- [ ] Cableada en `src/app/globals.css` a través del token/var correspondiente (`--font-heading` y/o `--font-sans`) — sin hardcodear la font en componentes; se cambia en un solo lugar.
- [ ] **Decisión de alcance a confirmar al ejecutar** (ver Notas): ¿reemplaza solo los **headings** (Inter Tight), o **todo el sans** (headings + body)? Default propuesto: **headings** (menor riesgo de legibilidad en cuerpo de texto), con Inter conservado para body.
- [ ] **Presupuesto de preloads neto-cero (crítico — ver T-123):** Bricolage **reemplaza** una familia existente, **no** se añade como tercera. Cada `next/font` es un preload render-critical en cada página; el árbol hoy carga exactamente 2 (Inter + Inter Tight) tras el trim de T-123. Si Bricolage cubre headings, se retira Inter Tight; si cubre todo, se retiran ambas.
- [ ] La app renderiza con la nueva tipografía en headings/títulos (`h1..h6`, `.font-heading`) y, si aplica al body, en el texto general — verificado visualmente en desktop y mobile.
- [ ] Fallback stack intacto (`ui-sans-serif, system-ui, sans-serif`) para el FOUT/no-webfont.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde + `pnpm build` (el bundle de fonts se resuelve en build).
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Setup actual (verificado):** `layout.tsx` carga `Inter` (`--font-inter`, body) e `Inter_Tight` (`--font-inter-tight`, headings) con `next/font/google`; `globals.css` mapea `--font-sans: var(--font-inter)` y `--font-heading: var(--font-inter-tight)`, y los headings + `.font-heading` usan `font-family: var(--font-inter-tight), …`. Cambiar la tipografía es, por diseño, editar estos dos archivos.
- **Contexto T-123 (importante):** un ticket de perf recortó las fonts a solo las 2 que la UI realmente usa porque "cada familia extra aquí es un preload render-critical en cada página". Por eso este ticket **sustituye**, no suma — mantener el conteo de webfonts en 2 (o menos).
- **Decisión de diseño (del usuario, al ejecutar/review):** headings-only vs todo el sans. Bricolage Grotesque es una display grotesque — suele lucir mejor en títulos que en párrafos largos; recomendación: empezar por headings y, si convence, extender a body en un follow-up. Como es un "probar", dejar el PR en draft para revisión visual antes de mergear.
- **Reversible:** si no convence, revertir es trivial (volver a Inter Tight). No hay migración ni datos.
- **Sin strings nuevos** (no hay UI/copy — es puramente tipográfico).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/bricolage-grotesque-font`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige; aquí: guard source-level de que la var de font está cableada, si aporta).
4. `pnpm typecheck && pnpm lint && pnpm test` + `pnpm build`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` — dejar en draft para **revisión visual** de la tipografía antes de mergear.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
