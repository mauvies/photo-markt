# T-200 · [DISEÑO] Bundles / "compra todas mis fotos" — precio por volumen

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/photo-bundles` (o solo el change de OpenSpec si se ejecuta el diseño primero)
- **OpenSpec change:** **sí** — toca pagos y precios; empezar con `/opsx:propose` antes de escribir código
- **PR:** —

## Requerimiento
Precio por volumen: en vez de pagar foto a foto, el atleta puede comprar **todas las fotos suyas de un evento**
(o un pack de N) a un precio mejor. Es el modelo de Sportograf y el usuario quiere trabajarlo pronto.

Encaja con billing v2 por una razón concreta: el service fee del comprador tiene un **componente fijo** por
compra, así que una compra de 8 fotos en un solo pago lo amortiza entre las 8 en vez de pagarlo 8 veces.
Un bundle es mejor para el comprador **y** para el margen de plataforma que 8 compras sueltas.

## Preguntas de diseño a resolver (esto es lo que hace el ticket de diseño)
- **Qué es un bundle:** ¿"todas mis fotos de este evento" (dinámico, depende del match facial) o "pack de N fotos" (fijo)? El primero es el que engancha con la búsqueda facial; el segundo es más simple de precificar.
- **Quién fija el precio:** ¿el fotógrafo por evento, un descuento por tramos de la plataforma, o ambos? Hoy `events.price_per_photo` es un único precio unitario.
- **Interacción con el carrito:** ¿el bundle es un ítem de carrito propio, o el carrito detecta que ya tienes N fotos del mismo evento y ofrece el upgrade? Lo segundo es mejor UX y bastante más trabajo.
- **Comisión y fee:** el neto del fotógrafo es `precio × (1 − comisión)` — hay que decidir si se aplica al total del bundle (lo natural) y cómo se reparte si el bundle cruza varios fotógrafos (evento colaborativo).
- **Reveal gate / eventos gateados:** en un evento con gate, "todas mis fotos" solo tiene sentido tras probar el match facial — el bundle no puede convertirse en una forma de destapar el evento entero.
- **Fotos ya compradas:** si ya compraste 3 sueltas y luego el bundle, ¿se descuenta lo pagado?

## Criterio de aceptación (Definition of Done)
- [ ] OpenSpec change con proposal + design (decisiones numeradas) + specs testeables + descomposición en tickets hijos
- [ ] El diseño responde explícitamente las preguntas de arriba, incluido el caso de evento colaborativo (varios fotógrafos en un mismo bundle) y el de reveal gate
- [ ] Aprobación del usuario antes de abrir los hijos de implementación

## Notas
- Origen: tarea 5.1 de `openspec/changes/billing-model-v2/tasks.md`, dejada explícitamente fuera de alcance de v2.
- Contexto económico en `docs/BILLING_MODEL.md`.
- El carrito/checkout es superficie compartida con T-195/T-196/T-198 — coordinar para no ejecutar en paralelo (en especial con T-199, que enciende el fee).
