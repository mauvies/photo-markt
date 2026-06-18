---
description: Captura un requerimiento como ticket y lo mete priorizado en BACKLOG.md
---

El usuario te da un requerimiento o tarea en `$ARGUMENTS` (o en el mensaje anterior).
Conviértelo en un ticket SIN implementarlo todavía:

1. Lee `BACKLOG.md`. Asigna el siguiente ID libre (`T-002`, `T-003`, …).
2. Decide **prioridad** (P0–P3) y **blockers** según lo que diga el usuario y lo que detectes
   (dependencias de otro ticket, de infra externa, de una decisión pendiente). Si no es obvio,
   propón una prioridad y di por qué en una línea — no preguntes salvo que sea ambiguo de verdad.
3. Crea `tickets/T-XXX-<slug>.md` a partir de `tickets/TEMPLATE.md`, rellenando requerimiento,
   criterio de aceptación y rama sugerida (`<tipo>/<slug>`).
4. Inserta la fila en la tabla de `BACKLOG.md` en su posición por prioridad (P0 arriba). Si queda
   con blockers, estado `blocked`; si no, `todo`.
5. Si el usuario menciona varias cosas, crea un ticket por cada una.
6. Reordena la tabla si hace falta y resume en 2–3 líneas: qué ticket creaste, prioridad y por qué,
   y cuál es ahora el siguiente a ejecutar.

Proactivo: si el requerimiento se solapa con un ticket existente, dilo en vez de duplicar.
No crees ramas ni hagas commits aquí — esto es solo captura.
