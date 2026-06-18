# T-014 · Traducir y dejar lista para producción la página de soporte

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/support-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado a 1 componente)
- **PR:** #61

## Requerimiento
La página de soporte falta traducir a español. Actualizarla, completarla y mejorarla para que esté lista
para producción, coherente con el resto de la app (conceptos, tono, contenido) y realmente útil para
nuestro caso (marketplace de fotografía deportiva: fotógrafos y talento).

## Estado actual (verificado)
- Rutas: `app/[lang]/dashboard/photographer/support` y `.../talent/support`, ambas renderizan el componente
  compartido **`components/support-page.tsx`** con prop `userRole`.
- El componente **no usa i18n** (no `useTranslations`/dictionary) → contenido hardcodeado, probablemente solo en inglés.

## Criterio de aceptación (Definition of Done)
- [ ] Todo el texto visible del soporte cableado a i18n (`useTranslations`/dictionary), nada hardcodeado
- [ ] Claves nuevas añadidas a `en.json` **y** `es.json`, traducción ES correcta y con el tono de la app
- [ ] Contenido completado/mejorado: secciones útiles (FAQ, cómo contactar, temas por rol fotógrafo/talento) coherentes con el producto
- [ ] Variación por `userRole` (fotógrafo vs talento) revisada y con sentido
- [ ] Links/acciones de contacto funcionan (email/soporte) y apuntan a destinos reales
- [ ] Se ve bien en mobile y desktop, en `es` y `en`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Archivo principal: `components/support-page.tsx`.
- Confirmar el canal de contacto real (¿`RESEND_FROM_EMAIL`? ¿formulario? ¿email directo?) antes de prometer algo en la copy.
- Mantener coherencia de marca: "Photo Markt", términos "fotógrafo"/"talento" como en el resto de la app.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/support-page-i18n-production`.
2. Acotado a 1 componente + diccionarios → implementar directo (sin OpenSpec).
3. Implementar contenido + i18n.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/support-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
