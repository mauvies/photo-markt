# T-016 · Completar y dejar lista para producción la página de privacidad

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/privacy-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado)
- **PR:** #63

## Requerimiento
Igual que T-014 pero para la **página de privacidad**: revisar la traducción a español, completar, mejorar
y dejar lista para producción, coherente con el resto de la app y legalmente útil para nuestro caso.

## Estado actual (verificado)
- `app/[lang]/privacy-policy/page.tsx` (pública, ~14 líneas) — **ya usa i18n**.
- `app/[lang]/dashboard/talent/privacy/page.tsx` (~61 líneas) — **ya usa i18n**.
- Como ya están cableadas, el foco es **completar/mejorar contenido** y verificar que el ES esté completo,
  no cablear desde cero.

## Criterio de aceptación (Definition of Done)
- [ ] Privacy policy pública (`/privacy-policy`) con contenido completo y production-ready en `es` y `en`
- [ ] Traducción ES revisada (sin claves faltantes, sin texto en inglés colado)
- [ ] Contenido coherente con cómo la app maneja datos: selfies efímeras (no se almacenan), AWS Rekognition,
      Stripe, almacenamiento de fotos, datos de cuenta — alineado con CLAUDE.md/ARCHITECTURE
- [ ] Página de privacidad del dashboard de talent revisada y coherente con la policy pública
- [ ] Se ve bien en mobile y desktop, en ambos idiomas
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Confirmar alcance con el usuario si hay duda:** "página de privacidad" puede referirse a la policy pública
  (`/privacy-policy`) y/o a los ajustes de privacidad del dashboard de talent. Por defecto cubrir la **policy pública**
  y revisar la de talent de paso.
- Contenido legal: describir el manejo real de datos (no inventar). Si hay dudas legales, marcarlas, no improvisar.
- Mismo patrón que T-014/T-015.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/privacy-page-i18n-production`.
2. Acotado → implementar directo (sin OpenSpec).
3. Implementar/completar contenido + i18n.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/privacy-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
