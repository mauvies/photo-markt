# T-007 · Mejorar toolbar de la galería del evento en mobile (favorito + modo selección sin salto)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/event-gallery-mobile-toolbar`
- **OpenSpec change:** —  (fix + polish de UI acotado)
- **PR:** —

## Requerimiento
En el dashboard de un evento, galería de fotos, vista **mobile**, dos problemas:
1. El botón de **guardar evento favorito** no se ve bien — mejorar su diseño/colocación.
2. El botón de **seleccionar** queda "guindando" en la pantalla; además, al activar el modo selección
   esa sección del botón desaparece y todo el contenido de abajo da un **salto hacia arriba**. Hay que
   evitar el salto (reservar el espacio / transición estable) y darle mejor colocación al botón.

## Enfoque acordado (mobile) — barra sticky única que sirve de toggle y de barra de selección
La causa del salto: el modo selección mostraba la barra de "fotos seleccionadas" arriba (antes encima del
header superior), pero ese header ya no existe ni en talent ni en fotógrafo en mobile; y al activar selección
la sección del botón "seleccionar" se quita, encogiendo el contenedor → el contenido de abajo salta.

Solución: **una sola sección sticky** en el mismo sitio que el botón "seleccionar", que se reutiliza para
ambos estados (no se elimina ni cambia de altura):
- **Estado normal:** muestra el botón "seleccionar" (y el de favorito).
- **Estado selección:** en ese mismo contenedor muestra el contador de fotos seleccionadas + una **X a la
  izquierda** para salir del modo selección (y las acciones de selección).
- El contenedor es **sticky** en el top de la pantalla al hacer scroll, con **altura estable** entre ambos
  estados → cero salto del contenido de abajo. El contenido por encima se deja tal cual.

## Criterio de aceptación (Definition of Done)
- [ ] Botón de favorito con diseño mejorado y bien integrado en el toolbar (mobile)
- [ ] Una única barra sticky reutilizada para "seleccionar" y para el modo selección (misma posición y altura)
- [ ] En modo selección: contador de seleccionadas + X a la izquierda para salir del modo
- [ ] Al entrar/salir del modo selección, el contenido de abajo NO salta (altura del contenedor estable)
- [ ] La barra queda sticky en el top al hacer scroll; el contenido por encima no cambia
- [ ] El botón de seleccionar ya no queda "guindando"
- [ ] Desktop sin regresiones
- [ ] La funcionalidad (favorito y selección) sigue intacta
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Página: `/dashboard/photographer/events/[id]` y/o `/dashboard/talent/events/[id]` — confirmar cuál(es) tienen el toolbar afectado.
- Clave del fix: **no desmontar/reemplazar el contenedor** al cambiar de estado; mantener el mismo nodo sticky y solo cambiar su contenido (toggle ↔ selección), conservando la altura.
- Mismo patrón de salto que T-004.
- Solo mobile para este enfoque sticky; desktop mantiene su comportamiento.
- Copies nuevos (contador "N seleccionadas", label de la X) → a `en.json` y `es.json`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/event-gallery-mobile-toolbar`.
2. Fix + polish acotado → implementar directo (sin OpenSpec).
3. Implementar + test de regresión si aplica al estado del toolbar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin fix/event-gallery-mobile-toolbar`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
