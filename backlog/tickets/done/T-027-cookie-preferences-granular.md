# T-027 · Personalización granular de cookies (panel "Gestionar preferencias")

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (Dep lógico: T-024 ya mergeado — construye sobre su sistema de consentimiento)
- **Rama:** `feat/cookie-preferences-granular`
- **OpenSpec change:** —  (UI + i18n acotado, extiende T-024)
- **PR:** #84

## Requerimiento
Mejora sobre el banner de cookies de T-024. Hoy el banner ofrece solo **Aceptar / Rechazar** (binario) para la
única categoría no esencial actual (analítica de Vercel). Añadir una opción **"Personalizar / Gestionar
preferencias"** que muestre las categorías de cookies con toggles por categoría, para que el usuario consienta
de forma **granular** (estándar de la industria, mayor transparencia, y requisito RGPD en cuanto exista más de
una finalidad no esencial).

## Estado actual (verificado)
- `src/components/cookie-consent-banner.tsx` — banner con dos botones (Aceptar/Rechazar), misma prominencia.
- `src/components/cookie-consent.tsx` — guarda `granted`/`denied` y monta `<WebAnalytics />` solo si `granted`.
- `src/lib/cookie-consent.ts` — estado binario (`'granted' | 'denied'`) en `localStorage`
  (`photo-markt_cookie_consent`), más evento `openCookiePreferences()` (lo usa el footer).
- **Categorías reales hoy:** Esenciales (sesión/auth, siempre on) · Analítica (Vercel, no esencial) ·
  Monitoreo de errores (Sentry, interés legítimo, no gateado). Solo **una** categoría no esencial → el binario
  actual es válido, pero no granular ni preparado para una segunda categoría.

## Criterio de aceptación (Definition of Done)
- [ ] Banner con tercera acción **"Personalizar"** (además de Aceptar todo / Rechazar todo) que abre un panel
- [ ] Panel con categorías y descripción por cada una:
      - [ ] **Necesarias** — siempre activas, toggle deshabilitado/bloqueado (informativo)
      - [ ] **Analítica** — toggle on/off (gatea `WebAnalytics`)
      - [ ] (Estructura extensible para añadir futuras categorías sin rehacer el modelo)
- [ ] Botón "Guardar preferencias" persiste la selección por categoría; "Aceptar todo" / "Rechazar todo" siguen
      disponibles como atajos
- [ ] **Migración de estado:** el `localStorage` pasa de `'granted'|'denied'` a un objeto por categoría
      (p. ej. `{ analytics: boolean }`); leer un valor legacy `granted`/`denied` debe mapear correctamente
      (no romper a usuarios que ya decidieron). Versionar la clave si hace falta
- [ ] `WebAnalytics` se monta solo si la categoría **analítica** está consentida (mantener el gating de T-024)
- [ ] Footer "Preferencias de cookies" reabre el panel (ya existe el `openCookiePreferences()`)
- [ ] Strings nuevos en `en.json` **y** `es.json` (nombres de categoría, descripciones, "Personalizar",
      "Guardar preferencias", "Aceptar todo", "Rechazar todo")
- [ ] Accesible (roles/labels, foco atrapado en el panel) y responsive; no tapa la bottom nav de talento en mobile
- [ ] Test: granted por categoría → analítica monta solo si su toggle está on; migración de valor legacy; falla
      antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **No es un fallo de cumplimiento urgente:** con una sola categoría no esencial y Rechazar de igual prominencia,
  T-024 ya cumple RGPD. Esto es **mejora de transparencia + preparación** para cuando haya 2+ categorías no
  esenciales (marketing/remarketing/A-B testing) — momento en que la granularidad pasa a ser obligatoria.
- Mantenerlo **simple**: sin librería pesada de CMP; extender el helper propio de T-024 a un modelo por categoría.
- Decidir si Sentry se expone como categoría informativa ("interés legítimo, siempre on") o se omite del panel.
  Por defecto: mostrarlo como informativo para máxima transparencia, sin toggle.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/cookie-preferences-granular`.
2. Acotado → implementar directo (sin OpenSpec).
3. Panel de categorías + modelo de estado por categoría + migración legacy + gating + i18n + test.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/cookie-preferences-granular`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
