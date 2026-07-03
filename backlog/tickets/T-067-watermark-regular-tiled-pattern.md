# T-067 · Rediseñar el watermark: patrón en mosaico regular y limpio

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/watermark-regular-tiled-pattern`  (tipo = feat)
- **OpenSpec change:** —  (se crea al ejecutar si toca >1 archivo; probablemente aislado en el pipeline de watermark)
- **PR:** —

## Requerimiento
Reemplazar el patrón de watermark actual (irregular, se ve poco pulido) por un **mosaico diagonal regular y uniforme** aplicado a las previews de fotos, con calidad cercana a la de marketplaces de foto deportiva establecidos (referencia estética: el watermark de SurfCloud — grid regular). Las capturas de referencia (Fotop, SurfCloud) son de competidores, NO de nuestra app (salvo la de Photo Markt, que es el estado actual a mejorar).

**Requisitos:**
- **Patrón en mosaico regular:** el watermark se repite en un grid diagonal uniforme por toda la imagen — espaciado y ángulo consistentes, no la colocación irregular/aleatoria actual.
- **Contenido de texto:** alternar entre "Photo Markt" (marca) y el nombre/handle del fotógrafo, tileados por la imagen. Ambos aparecen repetidos en el patrón (marca para protección + awareness; nombre del fotógrafo para atribución y su propio marketing).
- **Variación de tamaño:** variar el tamaño de las etiquetas dentro del patrón — algunas algo más grandes, otras más pequeñas — pero en un ritmo deliberado y regular (ej. alternancia consistente), NO aleatorio. Interés visual con orden, como SurfCloud.
- **Símbolo de marca:** incluir el logo/símbolo de Photo Markt junto a las instancias de texto "Photo Markt" **si existe un asset de símbolo** — investigar; si no existe, dejar solo texto y flaggear que un símbolo podría añadirse después.
- **Opacidad / legibilidad:** visible lo suficiente para disuadir el robo pero sin arruinar la preview (blanco semitransparente, legible pero no obtrusivo — balance de SurfCloud como referencia).
- **Reducción de resolución:** mantener la reducción de resolución de preview existente (las previews ya se sirven a calidad reducida). Este ticket **no** la cambia — solo confirmar que sigue en su sitio junto al nuevo watermark.

**Alcance:**
- Aplica a la generación de previews con watermark de fotos de **eventos de pago** (el pipeline de watermark existente, probablemente `src/app/api/watermark/` con Sharp — investigar y reemplazar solo la lógica del patrón).
- El watermark debe escalar con sensatez en distintos aspect ratios y dimensiones (retrato, paisaje, cuadrado) — el tiling se adapta, el espaciado se mantiene proporcional.
- Fotos de eventos gratis/colaborativos: confirmar que el comportamiento actual (probablemente sin watermark) queda **sin cambios**.

## Criterio de aceptación (Definition of Done)
- [ ] Las previews con watermark muestran un patrón diagonal en mosaico regular (espaciado y ángulo consistentes)
- [ ] El patrón alterna "Photo Markt" (con símbolo si está disponible) y el nombre/handle del fotógrafo
- [ ] Los tamaños de etiqueta varían en un ritmo deliberado y regular — no aleatorio
- [ ] El watermark es legible-pero-no-obtrusivo, comparable a la referencia de SurfCloud
- [ ] Funciona en fotos retrato, paisaje y cuadradas con escalado proporcional
- [ ] La reducción de resolución de preview existente sigue en su sitio
- [ ] Fotos gratis/colaborativas sin cambios
- [ ] Usa Sharp (dependencia existente) para el compositing; reusa el pipeline de watermark, reemplaza solo la generación del patrón; sin nuevas librerías UI
- [ ] test de regresión/feature que falla antes y pasa después (generación del patrón / adaptación por aspect ratio)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Fuera de alcance:** face blurring (ticket aparte); cambiar qué fotos llevan watermark o la lógica gratis-vs-pago; el pipeline de thumbnail/imagen responsive (reusar existente).
- **Sin UI/strings visibles nuevos:** el texto del watermark es la marca y el nombre del fotógrafo (dato, no copy de UI), así que probablemente **no** requiere entradas en `en.json`/`es.json`. Confirmar durante la implementación.
- **Investigar primero:** `src/app/api/watermark/` (según CLAUDE.md, "watermark: patrón tileado repetido, server-side vía Sharp") es el punto de entrada; el nombre del fotógrafo hay que pasarlo/derivarlo al generar la preview. Verificar si hay asset de símbolo/logo en `public/` antes de decidir texto-only.
- **Prioridad P2:** es pulido estético/de marca, no un bug ni bloqueo — mejora percepción de calidad y protección, pero no urgente.
- No se solapa con T-066 (modal de detalle de foto): aquel es layout de UI de compra; este es la generación server-side de la imagen con watermark.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/watermark-regular-tiled-pattern`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
