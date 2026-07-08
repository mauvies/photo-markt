# T-075 · Rediseño de la navegación del dashboard del fotógrafo (añadir Configuración, renombrar Ganancias→Ventas, reubicar ítems)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `feat/photographer-nav-redesign`  (tipo = feat)
- **OpenSpec change:** —  (se crea al ejecutar — toca sidebar + dropdown del avatar + bottom nav mobile + diccionarios; >5 archivos probable)
- **PR:** —

## Requerimiento
Rediseñar la navegación del dashboard del fotógrafo: añadir "Configuración" al sidebar, renombrar "Ganancias" → "Ventas", limpiar el dropdown del avatar (quitar enlaces ya redundantes con sidebar/Settings), y gestionar el bottom nav mobile porque el sidebar pasa a 6 enlaces (no caben todos en mobile).

**Estado actual:**
- Sidebar (5): Resumen · Eventos · Crear eventos · Ganancias · Perfil.
- Dropdown del avatar (header): enlaces a Pagos, Perfil, Configuración + Soporte y Feedback.
- Ojo: "Perfil" (sidebar) es la **página pública** del fotógrafo (estilo Instagram), distinta del **tab "Perfil" dentro de Configuración** (edita datos personales). Ambas son intencionales y se mantienen.

**Cambios:**
1. **Añadir "Configuración" (Settings) al sidebar** → enlaza a la página de Settings existente (la de tabs: datos de perfil, Pagos, Facturación, Idioma, etc.). Sidebar pasa a **6**: Resumen · Eventos · Crear eventos · Ventas · Perfil · Configuración.
2. **Renombrar "Ganancias" → "Ventas"** (Earnings → Sales): **solo el label**, en `en.json` y `es.json`. La ruta/página destino no cambia (si la ruta contiene "earnings"/"ganancias", mantenerla funcionando; solo cambia el texto visible).
3. **Limpiar el dropdown del avatar (header):** quitar "Pagos" (ya en Settings → Pagos), "Perfil" (el que duplica acceso a sidebar/Settings) y "Configuración" (ya en sidebar). **Mantener:** nombre+email (header no interactivo), indicador de rol ("Rol: Fotógrafo"), switcher de rol (Cambiar a Talento), **Soporte y Feedback** (se quedan aquí y se quitan del sidebar — ver punto 4), y **Cerrar sesión** al final. *Opcional (a discreción):* deep-links a "Pagos"/"Facturación" que abran el tab correspondiente de Settings — solo si queda limpio.
4. **Quitar Soporte y Feedback del fondo del sidebar** — ahora viven solo en el dropdown del avatar.
5. **Bottom nav mobile — problema de 6 enlaces:** desktop y mobile **no** necesitan ítems idénticos (divergencia intencional y estándar; ~5 ítems máx en mobile por ergonomía). Bottom nav (mobile): enlaces primarios de trabajo — Resumen, Eventos, Crear eventos, Ventas — **+ el avatar** (ya en el bottom nav; al tocarlo abre el dropdown de cuenta). **Configuración y Perfil (página pública)** en mobile: accesibles vía el dropdown del avatar (alcanzable desde el avatar del bottom nav). Recomendar la composición exacta durante la implementación, priorizando destinos frecuentes en el bottom nav y enrutando el resto por el dropdown; ningún destino queda inaccesible. → En mobile, el dropdown incluye además Configuración y Perfil público (aparte de rol, switch de rol, Soporte, Feedback, Cerrar sesión).

## Criterio de aceptación (Definition of Done)
- [ ] Sidebar desktop muestra 6 enlaces: Resumen, Eventos, Crear eventos, Ventas, Perfil, Configuración
- [ ] "Ganancias" renombrado a "Ventas" (solo label) en ambos idiomas; el destino sigue funcionando
- [ ] El enlace Configuración abre la página de Settings con tabs existente (reutilizada, no reconstruida)
- [ ] El dropdown del avatar ya no contiene Pagos, Perfil (redundante) ni Configuración; conserva info de usuario, rol, switcher de rol, Soporte, Feedback, Cerrar sesión
- [ ] Soporte y Feedback quitados del fondo del sidebar y presentes en el dropdown del avatar
- [ ] Bottom nav mobile se queda en ~5 ítems ergonómicos (enlaces frecuentes + avatar); Configuración y Perfil público alcanzables vía el dropdown en mobile — ningún destino inaccesible
- [ ] La página pública Perfil y el tab Configuración → Perfil siguen distintos y ambos funcionan
- [ ] Todas las etiquetas nuevas/renombradas en `en.json` y `es.json`
- [ ] test de feature/regresión apropiado (composición de la nav / helper de ítems por viewport)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Constraints:** componentes Shadcn existentes (sin nuevas librerías UI); reusar la página de Settings y sus tabs (no reconstruir); divergencia desktop/mobile intencional (no forzar ítems idénticos); sin `any`; Biome; ningún otro cambio.
- **No solapa** con el cluster Header/nav ya completado (T-002/T-003/T-006, PRs #70-72) — aquello fue estilo del toggler/avatar/bottom-nav; esto es la composición de enlaces de la nav del fotógrafo.
- **Puntos de código a ubicar al ejecutar:** el sidebar del dashboard del fotógrafo, el dropdown del avatar del header, el bottom nav mobile (introducido en T-006/T-043) y los diccionarios. El avatar ya está en el bottom nav por un cambio previo.
- **Prioridad P2:** mejora de UX/navegación, no bug ni bloqueo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/photographer-nav-redesign`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
