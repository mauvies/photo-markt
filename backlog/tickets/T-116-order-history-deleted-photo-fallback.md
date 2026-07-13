# T-116 · Fix: fallback elegante en el historial de órdenes cuando la foto ya no existe

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/order-history-deleted-photo-fallback`
- **OpenSpec change:** —  (fallback de render, acotado)
- **PR:** —
- **Cluster:** Carrito/previews & integridad — T-115 → T-116 → T-117 (ver notas)

## Requerimiento (Parte 2 del reporte)
En el historial de órdenes, las previews fallan para fotos de eventos **borrados**. Si la foto/evento se
borró legítimamente (p. ej. limpieza de desarrollo) **es esperado** — pero el modo de fallo debe ser
**elegante**: mostrar un fallback claro ("Photo no longer available" / "Foto no disponible" + ícono),
**nunca** una imagen rota ni un espacio en blanco.

**Distinción crítica (vs T-117):** las órdenes son **registros históricos** de una compra completada. Aun
si el archivo vivo de la foto ya no existe, la orden **NO** se borra ni se altera (el comprador ya pagó —
es un registro de facturación/legal). **Solo** el render de la preview obtiene un fallback.

## Criterio de aceptación (Definition of Done)
- [ ] En el historial de órdenes del talento, un ítem cuya foto/archivo ya no existe muestra un **fallback
      claro** (ícono + texto "Foto no disponible"/"Photo no longer available"), no una imagen rota ni un
      hueco vacío.
- [ ] Las órdenes y `order_items` **no se borran ni se modifican** — el fallback es puramente de
      presentación (no toca datos).
- [ ] El fallback distingue "foto no disponible" de un simple error transitorio de carga si es viable
      (o al menos no rompe el layout en ningún caso).
- [ ] strings nuevos en `en.json` y `es.json` ("Foto no disponible" / "Photo no longer available").
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: render de un ítem de orden con
      foto inexistente → muestra el fallback, no un `<img>` roto).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] **Consideración de negocio (solo documentar en el PR, NO implementar):** ¿deberíamos archivar una
      copia permanente de la foto para compras completadas, para que esto nunca pase con contenido pagado?
      Dejarlo como consideración aparte; este ticket solo hace el fallback.

## Notas
- **Archivos probables:** `src/app/[lang]/dashboard/talent/orders/` (página + componente de ítem de
  orden). Reusar el patrón de fallback ya existente (`ImageIcon` + texto, mismo que usa la grilla cuando
  la imagen no carga, p. ej. `imageUnavailableLabel`).
- Verificar primero (parte de la investigación) si las previews rotas actuales corresponden a fotos
  realmente borradas (row de `photos` y archivo de Storage ausentes) vs. el bug de resolución de T-115.
  Si son fotos activas, es T-115, no esto.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/order-history-deleted-photo-fallback`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
