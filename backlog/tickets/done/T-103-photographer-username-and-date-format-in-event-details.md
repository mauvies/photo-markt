# T-103 · Mostrar el nombre del fotógrafo + fecha en formato natural por idioma en la línea de metadatos del evento

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/photographer-username-in-event-details`  (tipo = feat)
- **OpenSpec change:** —  (UI acotada, dos archivos con el mismo patrón)
- **PR:** #168

## Requerimiento
Las páginas de evento (vista pública `/events/[code]` **y** dashboard de talento
`/dashboard/talent/events/[code]`) hoy no muestran en ningún lado quién es el fotógrafo. En la línea de
metadatos debajo del título (hoy: **fecha · ubicación · precio por foto**) hay que hacer dos cambios:

### 1. Añadir el nombre del fotógrafo a la línea de metadatos
- Insertarlo **antes** del precio por foto → orden: **fecha · ubicación · fotógrafo · precio por foto**
  (fotógrafo justo antes del precio).
- El nombre/username es un **enlace** al perfil público del fotógrafo (`/[lang]/photographer/[slug]`, la
  ruta de perfil público **ya existente** — no crear una nueva). El nombre ya está resuelto en ambas
  páginas como `uploaderProfiles[event.user_id]?.username` (hoy solo se pasa al modal de detalle de foto,
  no se renderiza en la línea); reusar el mismo enlace `@username → /[lang]/photographer/[username]` que
  ya usa el modal de detalle de foto (T-066). **Verificar** por qué identificador resuelve la ruta
  (`slug` vs `username`) y usar el campo correcto del perfil.
- **Estilo consistente** con el resto de la línea (mismo tamaño/peso que fecha y ubicación) — es
  metadato con enlace, **no** un CTA prominente ni un botón.
- Si el evento no tiene nombre/username resuelto, omitir el segmento limpiamente (sin `@` colgando ni
  separador `·` de más), igual que el precio es condicional.

### 2. Reformatear la fecha al formato natural de cada idioma
- Reemplazar el formato actual (`new Date(event.date).toDateString().split(' ').slice(1).join(' ')`, que
  da "Jul 05 2026" — mes abreviado y **siempre en inglés**, ignora el locale) por un formato **natural
  por locale** con `Intl.DateTimeFormat` (o la utilidad de fecha del codebase si existe):
  - **Español:** día, mes (nombre), año → p.ej. "6 junio 2026".
  - **Inglés:** mes (nombre), día, año, convención estándar en inglés → p.ej. "June 6, 2026".
- **NO** hardcodear un único orden literal para ambos idiomas — usar el formato apropiado por locale
  (`Intl.DateTimeFormat(locale, { day:'numeric', month:'long', year:'numeric' })` produce el orden
  natural de cada idioma automáticamente).
- Aplicar este formato de fecha **de forma consistente** dondequiera que aparezca la fecha de esta línea
  de metadatos. **Investigar y reportar:** ¿hay un segundo formato de fecha en la misma página que
  deba reconciliarse, o dejarse distinto a propósito porque sirve otro fin? (candidatos: el modal de
  detalle de foto ya formatea con Intl; el JSON-LD usa ISO cruda por spec de schema.org; copys tipo
  "próximamente / fotos tras el evento"; "contribuir abre el {fecha}"). Reconciliar o justificar.

## Criterio de aceptación (Definition of Done)
- [ ] La línea de metadatos muestra el nombre del fotógrafo, posicionado **antes** del precio por foto
- [ ] El nombre del fotógrafo **enlaza** a su perfil público ya existente (`/[lang]/photographer/[slug]`)
- [ ] La fecha se formatea con la convención natural de cada idioma (día-mes-año en español,
      mes-día-año en inglés) vía `Intl.DateTimeFormat` (o utilidad existente) — **no** un orden único
      hardcodeado; ya no aparece el mes abreviado en inglés en la vista `es`
- [ ] Aplica a `/events/[code]` y `/dashboard/talent/events/[code]`; la página de evento del **dashboard
      del fotógrafo queda sin cambios**
- [ ] El estilo del nombre del fotógrafo es consistente con el resto de la línea (no un CTA sobredimensionado)
- [ ] Sin regresión en los otros metadatos (ubicación, precio, etc.)
- [ ] Un único helper de formateo de fecha compartido por ambas páginas (no duplicar la expresión Intl)
      — evita que las dos vistas diverjan
- [ ] Reporte breve de la investigación de "segundo formato de fecha en la misma página"
- [ ] strings nuevos en `en.json` y `es.json` **solo si** hace falta alguna etiqueta estática (la fecha
      en sí es formateada por locale, no traducida como string; el `@username` es dato)
- [ ] test de regresión/feature que falla antes y pasa después (formateo por locale es≠en + presencia y
      enlace del nombre del fotógrafo en la línea)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Archivos:** `src/app/[lang]/events/[shareCode]/page.tsx` (línea de metadatos ~504-513) y
  `src/app/[lang]/dashboard/talent/events/[id]/page.tsx` (~319-328). **Ambos tienen el patrón idéntico**
  (misma expresión de fecha, mismo `· ciudad`, mismo bloque condicional de precio) → extraer un helper
  puro `formatEventDate(dateISO, locale)` (unit-testeable) y, si encaja, un componente `EventMetaLine`
  compartido, para no mantener el markup en dos sitios.
- **No hay utilidad de fecha compartida en `src/lib`** (verificado): el único formateo Intl vive como
  `formatDate(iso, locale)` local en `src/components/photo-detail-modal.tsx`. Candidato a **promover** a
  un helper compartido en `src/lib` y reusar aquí (cumple la constraint "usar la utilidad existente si
  existe"), en vez de hand-roll.
- **Conector "de" en español:** `Intl.DateTimeFormat('es', { day:'numeric', month:'long', year:'numeric' })`
  produce "6 de junio de 2026" (con "de … de"), no el "6 junio 2026" literal del ejemplo. Ambos respetan
  el **orden natural** (día-mes-año); el requerimiento de fondo es formato natural por locale vía Intl.
  Decidir al ejecutar: aceptar la salida nativa de Intl ("6 de junio de 2026", gramaticalmente correcta)
  o construir con `formatToParts` para el "6 junio 2026" compacto. El inglés ("June 6, 2026") sale
  idéntico al ejemplo con Intl nativo.
- **Fuera de alcance:** la vista del **propio dashboard del fotógrafo** (`/dashboard/photographer/
  events/[id]`) — el dueño no necesita ver su propio nombre; esa línea queda como está. Tampoco toca el
  watermark (eso es T-076, on-hold).

## Constraints
- Reusar la ruta de perfil público existente — no crear una nueva.
- Usar la utilidad de fecha existente si la hay; si no, `Intl.DateTimeFormat` con el locale correcto, no
  un formato string hand-rolled.
- Todas las strings visibles en `en.json` y `es.json` (si hace falta alguna etiqueta estática — la fecha
  es formateada por locale, no traducida).
- Sin tipos `any`; formato Biome.
- **No other changes.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/photographer-username-in-event-details`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
