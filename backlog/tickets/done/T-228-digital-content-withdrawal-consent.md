# T-228 · Casilla de desistimiento en el checkout (contenido digital)

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto  (pagos · legal)
- **Blockers:** ninguno — pero **conviene validarlo con un abogado antes de mergear** (ver Notas)
- **Rama:** `feat/digital-content-withdrawal-consent`  (tipo = feat)
- **OpenSpec change:** —  (dos strings + un check en ambos checkouts; el "por qué" va en el ticket)
- **PR:** #284

## Requerimiento

Los términos ya dicen lo correcto: *"Las fotos son bienes digitales que se entregan de inmediato tras
el pago, por lo que las compras son por lo general definitivas"*. La decisión de producto es no ofrecer
reembolsos voluntarios, y para contenido digital es defendible.

**Pero esa política no es exigible hoy.** La Directiva 2011/83/UE art. 16.m (en España, art. 103.m del
TRLGDCU) exime del derecho de desistimiento de 14 días al contenido digital sin soporte material
**solo si** concurren:

1. Consentimiento previo y expreso del consumidor para iniciar la ejecución
2. Su reconocimiento explícito de que **con ello pierde el derecho de desistimiento**
3. Confirmación del contrato por parte del comerciante (art. 8.7, añadido por la Directiva Ómnibus
   2019/2161)

Buscado en `en.json` y `es.json`: **no existe ninguna cadena de consentimiento de desistimiento en
ningún checkout**. Sin esos elementos la exención no aplica, el derecho de 14 días sigue vigente por
defecto, y una cláusula en los términos no lo anula — el derecho de consumo es imperativo y no se
puede excluir por contrato.

Resultado actual: política de "sin reembolsos", obligación legal de reembolsar.

## Criterio de aceptación (Definition of Done)

- [ ] Checkbox obligatorio en **ambos** checkouts (invitado en `cart/actions.ts` y autenticado en
      `dashboard/talent/cart/actions.ts`) con el doble consentimiento: iniciar la entrega ahora **y**
      reconocer la pérdida del derecho de desistimiento
- [ ] El servidor **no crea la sesión de Stripe** sin el consentimiento — no basta con validarlo en cliente
- [ ] El consentimiento se persiste con la orden (marca temporal + versión del texto), porque en una
      reclamación hay que poder probarlo
- [ ] La confirmación de compra por email incluye la constancia del consentimiento (art. 8.7)
- [ ] Strings en `en.json` y `es.json`
- [ ] La sección "Reembolsos" de los términos se alinea con el nuevo flujo
- [ ] Test de integración: checkout sin consentimiento es rechazado en servidor; con consentimiento
      procede y persiste la marca
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**No es asesoramiento legal.** El análisis anterior es la lectura general de la directiva y su
transposición; conviene que lo valide un abogado de consumo antes de mergear, sobre todo la redacción
exacta de las dos frases de consentimiento, que es donde se juega la validez.

**Lo que no se puede eliminar por contrato:** la Directiva (UE) 2019/770 da remedios por falta de
conformidad (archivo corrupto, fotos equivocadas, no entregadas). Es irrenunciable. El FAQ de soporte
ya lo contempla ("si la calidad es muy distinta a la vista previa... caso por caso") y debe seguir
existiendo — este ticket no lo toca.

**Tampoco elimina los chargebacks.** Ver T-215: una disputa la fuerza el comprador a través de su banco
y no pasa por los términos. Los dos tickets son independientes.

Verificado que un reembolso **sí** revoca el acceso hoy: `getTalentPurchasedPhotos`,
`getPurchasedPhotoIdsForEvent` y el historial filtran `status = 'completed'`. El escenario "descarga y
pide reembolso" no le deja la foto dentro de la app (el archivo ya descargado sí es irreversible, como
con cualquier bien digital).
