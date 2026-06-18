# T-013 · Estandarizar el diseño de tabs (underline) en toda la app

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/standardize-underline-tabs`
- **OpenSpec change:** —  (refactor de UI transversal; si crece mucho, evaluar propose)
- **PR:** —

## Requerimiento
La página de configuración del dashboard de talento usa un estilo de tabs que no gusta. Adoptar en
**toda la app** el estilo de tabs de la página de **favoritos** del dashboard de talento: tabs simples con
**línea/borde inferior**, donde el tab activo resalta su borde inferior. Revisar todos los tabs existentes
y aplicar este diseño de forma consistente.

## Criterio de aceptación (Definition of Done)
- [ ] Identificar el estilo de tabs de la página de favoritos (talent) como el patrón canónico (underline)
- [ ] Definir una única variante de tabs reutilizable (preferible: estilar el componente Shadcn `Tabs` una sola vez)
- [ ] Aplicar ese estilo a todos los tabs de la app (settings de talent y cualquier otro que use otra variante)
- [ ] Tab activo resalta con borde inferior; inactivos sin borde
- [ ] Sin regresiones funcionales en ninguna pantalla con tabs (mobile y desktop)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Primero **inventariar** dónde se usan tabs (grep de `Tabs`/`TabsList`/`TabsTrigger` y de tabs custom) y listar las pantallas afectadas.
- Lazy: si todos usan el componente Shadcn `Tabs`, basta con ajustar la variante/estilo en un sitio en vez de tocar cada página. (ponytail)
- Coordinar con **T-004** (tabs de eventos destacados): heredarán este estilo — alinear si se hacen cerca en el tiempo.
- Solo estilos; no cambiar la lógica de navegación entre tabs. Sin strings nuevos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/standardize-underline-tabs`.
2. Inventariar usos de tabs → estilar la variante canónica en un solo lugar si es posible. Sin OpenSpec salvo que el alcance explote.
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/standardize-underline-tabs`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
