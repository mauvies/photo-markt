# T-032 · Implementar reconocimiento de número de dorsal (BIB)

- **Prioridad:** P3
- **Estado:** doing  (fase de **diseño OpenSpec**; sin implementación hasta aprobación)
- **Blockers:** ninguno
- **Rama:** `feat/bib-number-recognition`
- **OpenSpec change:** **en curso** — `/opsx:propose`. Decisiones tomadas por el usuario: motor **Rekognition `DetectText`**; coste **opt-in por evento** (el fotógrafo activa la detección).
- **PR:** —

## Requerimiento
Anunciamos "BIB number recognition / Reconocimiento de dorsal" en los tres planes, pero **no está implementado**
(hoy va con badge "Coming soon" desde T-030). Implementar la detección del número de dorsal en las fotos y la
posibilidad de que el atleta busque sus fotos por número de dorsal.

## Estado actual (verificado)
- Cero código de BIB/dorsal (`grep -ri bib src/` no encuentra implementación).
- Anunciado en `pricingSection` (`freeFeature4`/`starterFeature4`/`proFeature4`), badge "Coming soon" tras T-030.
- Relación: el ticket descartado T-011 ("código de foto editable") ya apuntaba a que el valor real del dominio es
  el **dorsal buscable por el atleta** + OCR — este ticket retoma eso correctamente orientado a talent.

## Criterio de aceptación (Definition of Done)
- [ ] Pipeline de detección de dorsal en fotos (OCR/visión — evaluar AWS Rekognition `DetectText` ya que ya usamos
      Rekognition, o Textract), corriendo como job de Inngest junto al indexado de caras
- [ ] Persistir los dorsales detectados por foto (tabla/columna nueva — migración) con su confianza
- [ ] Búsqueda de talent por número de dorsal en la galería del evento (filtra a fotos con ese dorsal)
- [ ] Respetar el gating por plan si aplica (decidir: ¿es feature de todos los planes? la copy lo anuncia en los 3)
- [ ] Quitar el badge "Coming soon" de `freeFeature4`/`starterFeature4`/`proFeature4` en `plan-features.ts`
- [ ] Tests de la detección/búsqueda; strings nuevos en `en.json` y `es.json`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Feature grande (visión + migración + búsqueda + UI) → `/opsx:propose` para capturar el diseño antes.
- Coste: `DetectText`/Textract por foto tiene coste — evaluar correrlo solo on-demand o por evento opt-in.
- Privacidad: dorsales no son PII sensible, pero documentar el tratamiento.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/bib-number-recognition`.
2. Feature grande/BD → `/opsx:propose` → `/opsx:apply`.
3. Implementar pipeline + migración + búsqueda + UI + tests; quitar badge coming-soon.
4. `pnpm typecheck && pnpm lint && pnpm test`. `/code-review` (toca BD/jobs).
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin feat/bib-number-recognition`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar `done`, archivar en `backlog/BACKLOG.md`. `/opsx:archive`.
