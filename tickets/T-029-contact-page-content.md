# T-029 · Completar y traducir la página "Contacto" (`/contact`)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (Dep lógico: T-028 — comparten `en.json`/`es.json`)
- **Rama:** `feat/contact-page-i18n-production`
- **OpenSpec change:** —  (contenido + i18n acotado, mismo patrón que T-021/T-016)
- **PR:** —

## Requerimiento
La página pública `/contact` ("Contacto") hoy es solo un placeholder (`dict.staticPages.preparing`).
Escribir contenido real de contacto traducido es+en y dejarla lista para producción. Mismo tratamiento que se
dio a Terms (T-021) y Privacy (T-016).

## Estado actual (verificado)
- `src/app/[lang]/contact/page.tsx` (~14 líneas) — **ya usa i18n** pero solo renderiza
  `dict.staticPages.contactTitle` + `dict.staticPages.preparing` (placeholder).
- Enlazada desde el footer (`/contact`). Sin bloque de diccionario propio todavía.
- **Importante:** la app ya tiene `/support` con un **formulario de contacto real** (FAQs + form vía
  `submitFeedbackAction`, ver `src/components/support-page.tsx`). Esta página NO debe duplicar ese formulario.

## Criterio de aceptación (Definition of Done)
- [ ] `/contact` con contenido completo y production-ready en `es` y `en` (ya no usa `preparing`)
- [ ] Información de contacto real: email(s) de contacto/soporte (consistentes con los ya usados en la app, p. ej.
      `support@photomarkt.com` / `privacy@photomarkt.com`), y un **enlace claro a `/support`** para consultas de
      ayuda/uso (evitar duplicar el formulario de soporte)
- [ ] Opcional: enlaces a redes sociales **solo si existen** (hoy `SOCIAL_LINKS` en footer están vacíos — no
      inventar perfiles); horario/tiempo de respuesta solo si es real
- [ ] Nuevo bloque i18n (p. ej. `contactPage`) en `en.json` **y** `es.json` (sin texto en inglés colado en ES,
      sin claves faltantes) — reutilizar el layout/estilo de `/privacy-policy` o `/terms` para consistencia
- [ ] Email(s) como enlaces `mailto:` clicables (mismo patrón que el bloque de contacto de privacy/terms)
- [ ] Se ve bien en mobile y desktop, en ambos idiomas
- [ ] Test de paridad es/en del bloque nuevo (mismo patrón que `terms-of-service-dict.test.ts`): falla antes,
      pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Decisión de alcance:** Contacto = info de contacto + enlace a soporte (ligero). El formulario ya vive en
  `/support`. Si se quisiera un form propio en `/contact`, es un ticket aparte — no asumirlo aquí.
- No inventar canales de contacto que no existan. Usar emails ya presentes en el código.
- Comparte `en.json`/`es.json` con T-028 → ejecutar **después** de T-028 (con su PR mergeado) para evitar
  conflictos de diccionario.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/contact-page-i18n-production`.
2. Acotado → implementar directo (sin OpenSpec).
3. Implementar/completar contenido + i18n (en+es) + test de paridad.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/contact-page-i18n-production`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
