# T-028 · Completar y traducir la página "Sobre nosotros" (`/about`)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/about-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado, mismo patrón que T-021/T-016)
- **PR:** —

## Requerimiento
La página pública `/about` ("Sobre nosotros") hoy es solo un placeholder (`dict.staticPages.preparing`).
Escribir contenido real de "Sobre nosotros" traducido es+en, coherente con la propuesta de la app, y dejarla
lista para producción. Mismo tratamiento que se dio a Terms (T-021) y Privacy (T-016).

## Estado actual (verificado)
- `src/app/[lang]/about/page.tsx` (~14 líneas) — **ya usa i18n** pero solo renderiza
  `dict.staticPages.aboutTitle` + `dict.staticPages.preparing` (placeholder).
- Enlazada desde el footer (`/about`). Sin bloque de diccionario propio todavía.
- `staticPages` solo tiene títulos sueltos (`aboutTitle`) + el `preparing` compartido.

## Criterio de aceptación (Definition of Done)
- [ ] `/about` con contenido completo y production-ready en `es` y `en` (ya no usa `preparing`)
- [ ] Contenido coherente con el modelo real: marketplace de fotografía deportiva que conecta fotógrafos con
      atletas/talento; misión, qué resuelve, cómo funciona a alto nivel, para fotógrafos y para talento
- [ ] Secciones sugeridas: intro/misión, qué hacemos, para fotógrafos, para atletas/talento, y CTA/contacto
- [ ] Nuevo bloque i18n (p. ej. `aboutPage`) en `en.json` **y** `es.json` (sin texto en inglés colado en ES,
      sin claves faltantes) — reutilizar el layout/estilo de `/privacy-policy` o `/terms` para consistencia
- [ ] Se ve bien en mobile y desktop, en ambos idiomas
- [ ] Test de paridad es/en del bloque nuevo (mismo patrón que `privacy-policy-dict.test.ts` /
      `terms-of-service-dict.test.ts`): falla antes, pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- No inventar datos corporativos que no existan (no afirmar tamaño de equipo, sedes, métricas inventadas). Si
  falta info real (entidad legal, fundación), mantener el texto a nivel de producto/misión.
- Mismo patrón que T-014/T-015/T-016/T-021. Comparte `en.json`/`es.json` con T-029 → ejecutar en serie.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/about-page-i18n-production`.
2. Acotado → implementar directo (sin OpenSpec).
3. Implementar/completar contenido + i18n (en+es) + test de paridad.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/about-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR.
