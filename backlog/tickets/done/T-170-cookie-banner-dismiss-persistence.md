# T-170 · El banner de cookies reaparece tras cerrarlo (semántica de la X / persistencia)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (lleva una **decisión de producto** pequeña que se puede tomar al arrancar — ver Notas)
- **Rama:** `fix/cookie-banner-dismiss-persistence`  (tipo = fix)
- **OpenSpec change:** —  (comportamiento acotado de un componente; no toca pagos/BD/auth)
- **PR:** #227

## Requerimiento (reporte del usuario)
> Cerré el banner con la **X**, no sé si esto es deseado. Y luego, al visitar la página del **carrito**,
> el banner **volvió a aparecer** después de haberlo cerrado. No sé si esto es esperado.

## Causa raíz (verificada en código)
El consentimiento se persiste en **localStorage** (`photo-markt_cookie_consent`,
`src/lib/cookie-consent.ts`) y es **global** — si se hubiera escrito una decisión, sobreviviría a
cualquier navegación. El banner se muestra cuando `readCookieConsent()` devuelve **null** (sin
decisión). En `src/components/cookie-consent.tsx`:
- Solo **aceptar / rechazar / (personalizar → guardar)** llaman `commit()` → `writeCookieConsent()`.
- **Cualquier otro cierre NO escribe consentimiento.** El panel de preferencias es un `Dialog`
  (`cookie-preferences-panel.tsx`) cuyo cierre (X, Esc, click afuera) dispara
  `onOpenChange(false)` → `setView('closed')` **sin** `writeCookieConsent`. Entonces `readCookieConsent()`
  sigue null → al remontarse `CookieConsent` en la siguiente página (p. ej. el carrito), vuelve a
  `view='banner'`. **Eso es exactamente la reaparición reportada.**

**Ojo con la "X":** el `cookie-consent-banner.tsx` **en `main` NO tiene una X** (solo Customize/Reject/
Accept). La X que cerró el usuario es, o bien la **X del panel de preferencias** (camino de cierre
sin-commit descrito arriba), o una **versión desplegada** que difiere de `main`. Verificar contra el
deploy actual al ejecutar; el mecanismo de reaparición es el mismo en ambos casos (cierre que no
persiste decisión).

## Decisión de producto (elegir al arrancar — recomendación abajo)
¿Debe existir un cierre/X que descarte el banner **sin** elegir, y qué debe persistir?
- **Opción A (recomendada):** un cierre/descarte cuenta como **"rechazar no-esenciales"** →
  `writeCookieConsent(rejectAllConsent())`, así el banner **no reaparece** y no se activan analytics.
  Simple, cumple, y respeta la expectativa del usuario de que "cerrar = ya no molestar".
- **Opción B:** **no** ofrecer una X/descarte ambigua — obligar a una elección explícita (Accept/Reject/
  Customize). Entonces la reaparición es "correcta" pero se elimina el affordance que confunde. (El
  cierre del **panel** debe volver al banner o persistir según A, no dejar un estado sin decidir que
  reaparece.)
- Evitar el estado actual: un cierre que **parece** decidir pero deja `null` y reaparece.

## Criterio de aceptación (Definition of Done)
- [ ] Tras cerrar/descartar el banner (por el camino que se defina), **no vuelve a aparecer** al navegar
      a otra página (p. ej. el carrito) — reproducible antes del fix.
- [ ] Ningún camino de cierre deja el consentimiento en `null` de forma que reaparezca: o se persiste una
      decisión (Opción A) o se elimina el affordance de descarte ambiguo (Opción B).
- [ ] Consistencia entre el **banner** y el **cierre del panel** de preferencias (X/Esc/click-afuera):
      cerrar el panel sin guardar no debe re-disparar el banner en la siguiente navegación.
- [ ] Si se persiste "rechazar" al descartar, los analytics (categoría `analytics`) quedan **off**
      (paridad con `rejectAllConsent`).
- [ ] test de regresión que falla antes / pasa después: cerrar/descartar → `readCookieConsent()` deja de
      ser `null` (o el banner no se remonta) → en un segundo render/montaje el banner **no** se muestra.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — no es pérdida de datos ni pagos, pero es un **nag recurrente** en cada navegación y toca
  consentimiento (adyacente a cumplimiento GDPR); más que pulido. Por eso P2, no P3.
- **Cluster con T-169** (mismo componente): T-169 es el layout de botones/posición. **Coordinar merge**
  o ejecutar contiguos; si aquí se decide agregar/quitar una **X**, ese control vive en la misma fila de
  acciones que T-169 restila → alinear.
- Contexto histórico: banner de cookies = T-024 (PR #81) + panel granular T-027 (PR #84), ambos done.
- Al ejecutar, **confirmar contra el deploy** si el banner desplegado tiene una X propia (no está en
  `main`) para no dejar un camino de cierre sin cubrir.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cookie-banner-dismiss-persistence`.
2. Tomar la decisión de producto (A/B) → implementar el camino de cierre que persista/elimine el
   affordance + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
