# T-068 · Difuminar caras detectadas en las previews con watermark

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (coordinar con T-067 — mismo pipeline de preview; ver Notas)
- **Rama:** `feat/blur-faces-in-watermarked-previews`  (tipo = feat)
- **OpenSpec change:** —  (se crea al ejecutar — toca el worker de Inngest + generación de preview + posible persistencia de bounding boxes)
- **PR:** #130

## Requerimiento
Además del watermark, **difuminar todas las caras detectadas** en la versión con watermark (preview) de las fotos. Segunda capa de protección: aunque alguien quite el watermark con IA, una foto con las caras difuminadas no tiene valor — el/la atleta no es identificable — lo que disuade fuertemente el robo y la eliminación del watermark por IA. Referencia: SurfCloud difumina la cara del atleta en las previews por exactamente esta razón.

**Restricción crítica de orden (hay que acertar):** las caras se difuminan SOLO en la preview servida al navegador. La cara debe seguir **nítida** para:
- El indexado y la búsqueda facial de AWS Rekognition (difuminar antes de indexar rompería el face matching por completo).
- La foto original a resolución completa entregada al comprador tras la compra (el comprador recibe la foto real, sin difuminar).

Por tanto el orden del pipeline es: **indexar caras primero (cara nítida), LUEGO generar la preview con caras difuminadas**. El blur aplica solo a la variante preview, nunca al original y nunca antes de indexar.

**Investigación (primer paso):**
- Determinar si los bounding boxes de las caras ya están persistidos. La tabla `photo_faces` probablemente tiene columna `bounding_box` (aparece en `addPhotoFace` y en el tipo `FaceRecord` del worker de indexado). Si ya se persisten desde el `IndexFaces` de Rekognition, **reusarlos** — sin nuevas llamadas AWS.
- Si NO están o están incompletos, decidir la vía más limpia: persistirlos desde la respuesta de `IndexFaces` (que ya los devuelve) o añadir una llamada `DetectFaces`. Preferir reusar los datos de `IndexFaces` — **documentar el hallazgo en el PR**.

**Requisitos:**
- Difuminar **todas** las caras detectadas en la preview con watermark. Si hay varias personas, difuminar cada cara (proteger a todas hasta la compra).
- Fotos sin caras detectadas (paisajes, action shots sin cara visible): sin blur — solo watermark. Es correcto y esperado, sin errores.
- Fuerza del blur: suficiente para que la cara no sea identificable (Gaussian fuerte o pixelado sobre el bounding box, con un pequeño margen alrededor para que los bordes no queden nítidos). Nivel SurfCloud — claramente ocultada, no un suavizado ligero.
- Mapeo de coordenadas: los bounding boxes de Rekognition son relativos (ratios 0–1). Mapearlos correctamente a las dimensiones en píxeles de la preview, teniendo en cuenta cualquier resize entre la imagen indexada y la preview.
- Orden en el pipeline: el blur se aplica al generar la variante preview, DESPUÉS de que el indexado haya terminado y los bounding boxes estén disponibles. Si una preview se genera antes de terminar el indexado: o diferir la generación de preview hasta que las caras estén indexadas, o regenerar/parchear la preview cuando los boxes estén disponibles — recomendar el enfoque más limpio dado el pipeline async de Inngest.

**Alcance:**
- Aplica a las previews con watermark de fotos de **eventos de pago** con caras indexadas.
- Integrar con el procesamiento async de Inngest existente (worker de indexado de caras y cualquier generación de preview/thumbnail).
- El original y los datos de face-matching nunca se difuminan.

## Criterio de aceptación (Definition of Done)
- [ ] Las previews con watermark tienen todas las caras detectadas difuminadas lo suficiente para ser no identificables
- [ ] La foto original a resolución completa (entregada al comprador) NUNCA se difumina
- [ ] El indexado y la búsqueda IA siguen funcionando (caras indexadas nítidas, antes del blur)
- [ ] Fotos sin caras detectadas: solo watermark, sin blur, sin errores
- [ ] Bounding boxes mapeados correctamente a las dimensiones de la preview (el blur cae exactamente sobre las caras)
- [ ] Varias caras en una foto: todas difuminadas
- [ ] El origen de los bounding boxes está documentado en el PR
- [ ] Blur y watermark componen correctamente en la misma preview
- [ ] Usa Sharp para el compositing del blur; reusa los bounding boxes de Rekognition existentes (evita llamadas AWS extra); `safeCall` alrededor de Sharp/AWS/Storage en el worker de Inngest (patrón de `index-photo-faces`)
- [ ] test de regresión/feature que falla antes y pasa después (mapeo de coordenadas / caso sin caras / orden index-antes-de-blur)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Fuera de alcance:** rediseño del watermark (T-067 — aunque blur y watermark van sobre la misma preview, coordinar para que compongan bien: difuminar caras y watermark encima, o el orden que se vea mejor); cambiar la lógica de indexado/búsqueda facial; difuminar en el original o en las descargas compradas.
- **Coordinación con T-067 (no bloqueante, pero ejecutar contiguos):** ambos tocan la generación de la preview con watermark. Si T-067 va primero, este ticket añade el blur como paso previo al composite del watermark. Si van en paralelo habrá conflicto en el pipeline de watermark — mergear uno antes de empezar el otro. Considerar clusterizarlos.
- **Sin strings visibles nuevos:** es procesamiento de imagen server-side; probablemente no requiere `en.json`/`es.json`.
- **Puntos de integración a investigar:** `src/lib/inngest/functions/index-photo-faces.ts` (indexado + `FaceRecord`/`bounding_box`), `src/database/queries/rekognition.ts` (`addPhotoFace`, `photo_faces.bounding_box`), y el pipeline de preview/watermark (`src/app/api/watermark/` o la generación de variantes). El orden index-primero es la parte delicada del pipeline async — de ahí el OpenSpec change.
- **Prioridad P2:** protección anti-robo de valor real, pero no urgente ni bloqueante; se prioriza junto al resto del cluster de previews (T-067).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/blur-faces-in-watermarked-previews`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
