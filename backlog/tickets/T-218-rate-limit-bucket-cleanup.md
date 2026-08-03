# T-218 · `rate_limit_buckets` crece sin límite

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (BD)
- **Blockers:** ninguno
- **Rama:** `chore/rate-limit-bucket-cleanup`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

La tabla acumula una fila por `(bucket_key, window_start)` y **nada la purga**. Reconocido en
`CLAUDE.md`: *"No automatic cleanup yet — fine at current scale"*.

Con ventanas horarias por `(evento, IP)` más contadores diarios por evento y global, el crecimiento es
proporcional a tráfico × eventos y no se detiene nunca.

No es urgente, pero es de los que se convierten en incidente justo cuando llega el tráfico real — y el
limitador **falla abierto**, así que una tabla degradada desactiva silenciosamente los throttles
(incluido el que controla el gasto en AWS) en el peor momento posible. El breaker de coste sí falla
cerrado, así que ese degrada a "temporalmente no disponible" en vez de destapar la factura.

## Criterio de aceptación (Definition of Done)

- [ ] Cron de Inngest que borra filas con `window_start` anterior a la ventana más larga en uso × 2
- [ ] El slot del cron no contiende con los existentes (`0,30` limpieza de storage, `15,45` reconciliación)
- [ ] Índice sobre `window_start` si el plan de borrado lo requiere
- [ ] Test de integración: las filas antiguas se borran, la ventana vigente sobrevive
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Contexto: `src/lib/rate-limit.ts`, migraciones `*rate_limit*`.
