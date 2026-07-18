# T-147 · Rediseñar el hero de la landing de fotógrafos (`/photographers`) — hacerlo distintivo

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (Option B no depende de assets; ver nota sobre Option A)
- **Rama:** `feat/redesign-photographers-hero` (tipo = feat)
- **OpenSpec change:** — (rediseño visual de una sección; no toca pagos/auth/BD/IA)
- **PR:** —

## Requerimiento
El hero de `/photographers` es estructuralmente correcto (headline, subtítulo, un CTA claro) pero **visualmente genérico**: fondo con gradiente + dos blobs difuminados + texto con gradiente recortado = look de plantilla por defecto. Para una landing cuyo trabajo es **convertir fotógrafos** (audiencia visualmente exigente), un hero templado resta credibilidad. Rediseñarlo para que sea **distintivo y anclado en el tema (fotografía deportiva)**, conservando estructura e intención del copy. **Solo cambia el tratamiento visual** — no la IA, el copy ni el destino del CTA.

## Conservar (no cambiar)
- Headline "Vende Tus Fotos De Eventos." / su equivalente en inglés, e **intención** del subtítulo.
- El único CTA primario "Empezar como fotógrafo" → `/signup`, con la flecha.
- El rol y posición de la sección (rediseño visual, no cambio de contenido/IA).
- i18n en `en.json` y `es.json`.

## Contexto (verificado en el código)
- Hero en `src/app/[lang]/photographers/page.tsx:39-64`: `section` con `bg-linear-to-br from-background via-background to-primary/5`, **dos blobs** `blur-3xl` (líneas 41-42), y el **span de headline** con `bg-clip-text text-transparent` + gradiente (línea 48). Copy vía `p.heroHeadline1`/`heroHeadline2`/`heroSubtitle`/`heroCta` (sección `photographers` del diccionario).
- **Assets:** `public/` **no** tiene imágenes de fotografía deportiva (solo favicons, logos, `google.svg`, `watermark/watermark-tile.png`). → **Option A (imagen real) NO es viable hoy** con los assets del repo.

## Parte 1 — Elegir enfoque según assets (investigar primero)
- **Option A — imagen real (preferida si hay assets):** hero con fotografía deportiva real (split layout copy/imagen, o full-bleed con overlay legible). **Solo** con imágenes con derechos (fotos propias del founder o licenciadas; nunca de terceros/sin licencia; sin personas identificables sin consentimiento). Requiere que el founder aporte las imágenes.
- **Option B — sin imagen, craft elevado (fallback):** hero tipográfico/abstracto pero **muy por encima de la plantilla**: composición intencional, tratamiento de tipo con carácter, CTA y fondo considerados, espaciado preciso. Sin dependencia de assets.
- **Recomendación (dado que no hay assets con derechos en el repo): hacer Option B ahora.** Option A queda para después, cuando existan fotos reales de eventos con derechos. **Reportar en el PR qué opción se eligió y por qué.** No fabricar ni usar imágenes sin licencia para habilitar A.

## Parte 2 — Principios del rediseño (cualquiera de las dos opciones)
- **Anclarlo al tema:** que se sienta de fotografía deportiva, no de plantilla SaaS. Reemplazar el combo blob+gradiente+texto-gradiente por una decisión deliberada.
- **La tipografía carga la personalidad:** jerarquía/escala/peso intencionales, más allá de un span con gradiente recortado. En Option B puede ser el driver visual principal.
- **Gastar audacia en un solo lugar:** un elemento "firma" memorable; el resto, callado y disciplinado. Evitar apilar efectos (varios blobs + texto gradiente + animaciones = el "tell" de generado por IA).
- **Respetar el design system:** usar los tokens existentes (`primary`, `background`, `muted-foreground`, etc.), Tailwind y Shadcn — sin libs UI nuevas ni paleta inventada. La distinción viene de composición y tipo.
- **Motion (si hay):** restringido y con propósito (a lo sumo un reveal de carga/scroll), respetando `prefers-reduced-motion`.

## Criterio de aceptación (Definition of Done)
- [ ] El hero ya **no** se lee como plantilla por defecto (blobs difuminados + texto con gradiente recortado reemplazados por un tratamiento deliberado anclado al tema).
- [ ] La opción (A imagen real vs B craft elevado) se eligió según disponibilidad de assets con derechos y **se reporta** en el PR. Sin imágenes sin licencia/de terceros; sin personas identificables sin consentimiento.
- [ ] Se conservan headline, intención del subtítulo y el único CTA primario (→ `/signup`).
- [ ] Usa tokens/Tailwind/Shadcn existentes — sin libs UI nuevas ni paleta inventada.
- [ ] **Totalmente responsive**; intencional en mobile (no solo desktop); **focus de teclado visible** en el CTA; `prefers-reduced-motion` respetado.
- [ ] El hero **no** es full-viewport-height salvo que lo justifique; debe **guiar** hacia el resto de la página (how-it-works, trust, pricing), consistente con el hero compacto de la landing de talento.
- [ ] Resto de `/photographers` (how-it-works, trust, pricing, FAQ, CTA) **intacto**.
- [ ] strings nuevos (si el diseño añade texto visible) en `en.json` **y** `es.json`; los existentes se preservan.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build` si toca algo del client-graph).

## Notas
- Alcance: **solo el `<section>` hero de `/photographers`**. No solapa con otro ticket abierto.
- Sin migración, sin pagos/auth → sin `/code-review` obligatorio; la revisión visual humana en el merge del draft es el control. Recomendado un screenshot/preview del hero en mobile+desktop en el PR.
- "Intención del subtítulo" = mismo mensaje; se puede reescribir el copy solo si el rediseño lo pide, manteniendo el significado (preferible conservarlo tal cual).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/redesign-photographers-hero`.
2. Investigar assets (confirmar A vs B) → implementar directo el rediseño del hero.
3. `pnpm typecheck && pnpm lint && pnpm test` (+ `build` si aplica).
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main` (reportar A/B elegida + screenshot).
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
