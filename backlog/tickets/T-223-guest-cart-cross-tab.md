# T-223 · Carrito de invitado sin sincronización entre pestañas

- **Prioridad:** P3
- **Estado:** todo
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `fix/guest-cart-cross-tab`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`GuestCartProvider` lee `localStorage` al montar y escribe en cada cambio, pero **no escucha el evento
`storage`**. Dos pestañas abiertas divergen: añadir una foto en la pestaña A no aparece en la B, y
—peor— el siguiente escrito de B **pisa** el carrito de A por completo, porque cada pestaña serializa
su propio array.

Es escenario real en este producto: los compradores navegan un evento, abren fotos en pestañas nuevas,
y vuelven.

## Criterio de aceptación (Definition of Done)

- [ ] Listener de `storage` que rehidrata el estado cuando otra pestaña escribe la clave
- [ ] Test con happy-dom que simule un evento `storage` y verifique la convergencia
- [ ] Verificado que no reintroduce el flash de estado vacío que corrigió T-176
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

El provider ya maneja bien la hidratación (flag `hydrated` con comentario explicando por qué los
consumidores no deben tratar el vacío como vacío real). Solo falta la otra mitad.

Contexto: `src/components/guest-cart-provider.tsx:34-53`.
