# T-108 · [DISEÑO] Auto-rellenar campos del evento desde la portada / EXIF de las fotos

- **Prioridad:** P3
- **Estado:** blocked
- **Blockers:** decisión de producto/diseño — qué señal usar (EXIF vs. modelo de visión), coste y fiabilidad
- **Rama:** `feat/event-autofill` (al desbloquear)
- **OpenSpec change:** — (sí al ejecutar: feature nueva con dependencia externa)
- **PR:** —
- **Dep:** T-105 (la portada vive en el paso Detalles)

## Requerimiento
Idea del usuario: con la portada ya en el paso Detalles, integrar a futuro "algún modelo o algo que reconozca los
datos de la imagen de la portada y rellene los datos del formulario automáticamente". Capturar la idea para
diseñarla; **no** implementar aún.

## Opinión / dirección técnica (para el diseño)
La señal más fuerte y barata **no es la portada en sí, sino el EXIF** de las fotos subidas:
- **EXIF GPS** → reverse-geocode a ciudad/estado/país (pre-rellena T-107, con confirmación del usuario).
- **EXIF timestamp** → fecha + hora de sesión (pre-rellena T-106, siempre editable — la cámara puede ir mal).
- Esto **no necesita IA**: es lectura de metadatos + una llamada de geocoding.

La portada como imagen es señal **débil** para nombre/ciudad/fecha (una hero-shot rara vez lleva ese texto). Un
modelo de visión sí podría inferir la **actividad** (surf/running/ciclismo) con bajo riesgo, y OCR sobre carteles
del evento (ya tenemos Rekognition `DetectText` para dorsales) podría pillar el nombre en un banner — pero poco
fiable. **Recomendación:** empezar por autofill vía EXIF (alto ROI, sin coste de modelo) y dejar el vision-model
como capa opcional encima. Todo autofill debe ser **sugerencia editable**, nunca sobrescribir en silencio.

## Criterio de aceptación (Definition of Done) — a refinar en el diseño
- [ ] Decidir fuente(s): EXIF de fotos, EXIF de portada, y/o modelo de visión (y cuál).
- [ ] Autofill como sugerencia confirmable, no sobrescritura silenciosa; el usuario siempre puede editar.
- [ ] Coste/privacidad evaluados (llamadas AWS/geocoding por evento; los bytes no cruzan límites de Inngest —
      patrón `safeCall`).
- [ ] Tests de las funciones puras (parseo EXIF, mapeo a campos).

## Notas
Sinergia directa con **T-106** (hora) y **T-107** (ubicación): esos dos definen los campos destino; este ticket
los **pre-rellena**. Ejecutar después de ambos. Blocked hasta que el usuario decida alcance (solo EXIF vs. añadir
visión) y confirme el coste.
