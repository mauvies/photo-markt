# T-221 · `/api/thumb` sin `maxDuration` ni rate limit

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `fix/thumb-route-limits`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`/api/watermark/[...path]` tiene `maxDuration = 15` y un rate limit por IP. Su hermana
`/api/thumb/[...path]` **no tiene ninguno de los dos**, pese a servir desde el mismo bucket privado con
el mismo cliente de servicio.

La ruta está bien endurecida por lo demás (rechaza traversal, exige el segmento `thumbs/`, falla
cerrada con 404 sin cuerpo, cachea inmutable en el edge) y las rutas son UUIDs no adivinables, así que
el vector de abuso es estrecho. Pero un **cache miss** con ruta válida sigue golpeando Supabase sin
techo de tiempo ni de frecuencia, y la asimetría con la ruta hermana es justo el tipo de deriva que
hace que la próxima ruta de bytes nazca también sin límites.

## Criterio de aceptación (Definition of Done)

- [ ] `maxDuration` en `/api/thumb` acorde a su trabajo (más bajo que watermark: no hay Sharp)
- [ ] Rate limit por IP con límite generoso — es camino caliente de galería, **medir antes de fijar el número**
- [ ] Test que verifique que **ambas** rutas de bytes declaran las dos protecciones, para que la
      próxima no nazca sin ellas
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Mismo patrón que el test de inventario de `SECURITY DEFINER` del PR #279: la protección no es el
arreglo puntual, es el test que impide que vuelva a divergir.

Contexto: `src/app/api/thumb/[...path]/route.ts` vs `src/app/api/watermark/[...path]/route.ts:5,12,106`.
Hallazgo F-22 del `CACHING_AUDIT`, que se resolvió solo para `watermark`.
