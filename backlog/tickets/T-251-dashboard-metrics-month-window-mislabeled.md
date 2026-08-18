# T-251 · «Fotos subidas» y «Eventos creados» dicen 0 con 35 fotos y 1 evento

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** normal  (`alto` = pagos · BD/migraciones · auth · seguridad → `/work-next` entra en plan mode y espera aprobación antes de escribir, y corre `/code-review`)
- **Blockers:** ninguno
- **Rama:** `fix/dashboard-metrics-month-window-mislabeled`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
En la ruta de resumen del dashboard de fotógrafos (`/[lang]/dashboard/photographer`) hay métricas
arriba de la pantalla. Entre ellas «Fotos subidas» y «Eventos creados»: el usuario tiene **un evento
con ~35 fotos** y ambas tarjetas muestran **0**. No está tomando correctamente los valores de fotos
subidas y eventos creados.

## Diagnóstico (confirmado contra producción, 2026-08-18)

**Los números no están mal: las etiquetas mienten.** Las cuatro tarjetas de `MetricsRow` son métricas
**del mes en curso** — `getCachedDashboardData` las calcula con `monthBounds(now)`, que va del día 1
del mes actual hasta ahora (`actions.ts:139`, `:186-189`). Pero solo dos de las cuatro etiquetas dicen
el periodo:

| clave del diccionario | copy es.json | copy en.json | ¿dice el periodo? |
|---|---|---|---|
| `earningsThisMonth` | «Ingresos del mes» | "Earnings this month" | ✅ |
| `salesThisMonth` | «Ventas del mes» | "Sales this month" | ✅ |
| `photosUploadedThisMonth` | **«Fotos subidas»** | **"Photos uploaded"** | ❌ |
| `eventsCreatedThisMonth` | **«Eventos creados»** | **"Events created"** | ❌ |

Las dos que fallan son **exactamente** las dos que el usuario reporta. La clave del diccionario sí
lleva `ThisMonth`; el texto lo perdió, así que la tarjeta promete un total histórico y entrega un
conteo mensual.

**Confirmación en prod** (`yzdlueeeizdqwuicydbr`), cuenta `vzla_surf@gmail.com`:
un único evento vivo, «3ra Valida Los Caracas Open», creado el **2026-07-27**, con **35 fotos**
subidas todas el **2026-07-27**. Hoy es 2026-08-18 → la ventana del mes (2026-08-01 → ahora) contiene
legítimamente 0 eventos y 0 fotos. `getPhotosUploadedCount` y `getEventsCreatedCount` están bien
(filtran `deleted_at IS NULL` y, en fotos, además el `events!inner(deleted_at)`); el defecto es de
copy + de superficie.

**Y el total que el usuario espera ya está calculado y se tira a la basura.** `DashboardData.totals`
(`totalEvents`, `totalPhotos` — histórico, correcto) se computa en cada render de esta página y
**no se pinta en ninguna parte**: su único uso en `page.tsx:70-71` es decidir el flag `isBrandNew`.
El dato correcto viaja hasta el componente y muere ahí. (Sí se pinta en
`settings/billing/page.tsx:257`, con la clave `photographerDashboard.photosUploaded` = «fotos
subidas», que es de hecho el total histórico — dos superficies usando texto casi idéntico para dos
números distintos.)

Efecto colateral correcto que **no** hay que romper: `isBrandNew` usa los totales, así que este
fotógrafo **no** cae en el estado `WelcomeEmpty` — ve la fila de métricas con ceros, que es
justamente el síntoma reportado.

## Criterio de aceptación (Definition of Done)
- [ ] Ninguna tarjeta de `MetricsRow` promete un total histórico entregando un conteo mensual: las
      cuatro etiquetas declaran su periodo, en `es.json` y `en.json`.
- [ ] El fotógrafo puede ver desde el resumen su **total histórico** de fotos subidas y eventos
      creados (los `totals` que ya se calculan dejan de ser datos muertos). ⚠️ `StatCard` hoy pinta
      `trend` **o** `sublabel`, nunca ambos (`stat-card.tsx:44-64`) — decidir en la implementación si
      se permite pintar los dos o dónde vive el total; el caso reportado tiene `trend === null`
      (mes anterior en 0 ⇒ `computePct` devuelve `null`), así que un `sublabel` a secas taparía el
      bug justo en el escenario que lo destapó.
- [ ] Con un evento y sus fotos creados el **mes pasado**, la pantalla no puede leerse como «no
      tengo nada»: 0 del mes y el total histórico son distinguibles a simple vista.
- [ ] `isBrandNew` sigue basándose en los totales (una cuenta con historia nunca ve `WelcomeEmpty`).
- [ ] strings nuevos en `en.json` y `es.json` (si hay UI)
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Archivos:** `src/app/[lang]/dashboard/photographer/_components/metrics-row.tsx`,
  `.../_components/stat-card.tsx`, `.../page.tsx` (hoy no pasa `data.totals` a `MetricsRow`),
  `src/dictionaries/{es,en}.json` (`photographerDashboard.photosUploadedThisMonth`,
  `eventsCreatedThisMonth`).
- **No tocar las queries.** `getPhotosUploadedCount` / `getEventsCreatedCount` y la ventana
  `monthBounds` son correctas; ensancharlas a «histórico» rompería la fila de tendencia
  (`vs. mes anterior`), que es lo único que da sentido a la comparación mensual.
- **Test de regresión sugerido:** unitario sobre `MetricsRow` (RTL, como
  `test/unit/components/*.test.tsx`) que monte la fila con `photosUploaded: 0` + total histórico 35 y
  exija que el 35 sea alcanzable y que la etiqueta del 0 nombre el mes. Opcionalmente, un test que
  pine la semántica en `actions.ts` (evento y fotos del mes anterior ⇒ `metrics.photosUploaded === 0`
  **y** `totals.totalPhotos === 35`), que es la línea que separa «métrica del mes» de «total».
- **Consistencia de copy:** revisar de paso `photographerDashboard.photosUploaded` («fotos subidas»,
  el total histórico que usa billing) para que las dos superficies no llamen igual a cosas distintas.
- Emparentado con **T-229** (conteo de fotos de la event card) y **T-209** (progreso de indexado
  «0 de 0»): misma familia de defecto — un número correcto bajo una etiqueta que promete otra cosa.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
