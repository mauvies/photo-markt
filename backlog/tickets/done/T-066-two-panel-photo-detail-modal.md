# T-066 · Modal de detalle de foto a dos paneles (imagen + panel de info/CTA de compra)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/two-panel-photo-detail-modal`  (tipo = feat)
- **OpenSpec change:** —  (se crea al ejecutar — toca >5 archivos: nuevo componente + hooks extraídos + 4 vistas + diccionarios)
- **PR:** #128

## Requerimiento
Crear un **nuevo** componente de detalle de foto a dos paneles, enfocado a la compra, que reemplace el overlay actual de acciones-como-íconos en las vistas de compra/navegación de fotos. Es el patrón de los marketplaces de foto deportiva (referencia de layout: competidor SurfCloud — las capturas son solo referencia, NO son de nuestra app).

**No reemplazar ni envolver el lightbox existente**: se queda intacto porque puede seguir usándose en otras secciones. Extraer la lógica compartida (prev/next, controles de teclado, carga de imagen) a hooks/utilidades reutilizables si aún no lo son, para no duplicarla entre ambos componentes.

Como las fotos de talent van con watermark y a resolución reducida, **no** hay capa secundaria de zoom a pantalla completa: la vista reducida a dos paneles es la presentación adecuada y orientada a conversión. Este es el único detalle de foto para contextos de compra.

**Layout desktop:**
- Modal partido en dos paneles.
- Panel izquierdo: la foto ocupando la mayoría del ancho, con controles prev/next.
- Panel derecho: columna estrecha de ancho fijo (fondo blanco) con: atribución del fotógrafo/uploader (con la lógica existente de "subido por" — enlace al perfil cuando aplique), ubicación (si hay), fecha, dimensiones (ej. 5776 × 4336px), precio por foto, info de descuento por volumen (cuando aplique, igual que el display existente), un botón primario grande y prominente (condicional — ver abajo), acciones secundarias (compartir, reportar/flag) y el contador ("X / Y").
- Botón cerrar (X) → vuelve a la galería.

**Layout mobile:**
- Sin columna lateral. Apilar en vertical: imagen arriba, panel de info/CTA abajo (mismo contenido que el panel derecho de desktop), botón primario prominente y alcanzable con el pulgar.
- Respetar safe-area insets para que los controles no queden ocultos por las barras del navegador (issue conocido del lightbox ya tratado antes).

**CTA primario condicional (reusar reglas existentes — NO hardcodear "Añadir al carrito"):**
- Foto de pago no comprada → "Añadir al carrito" (con precio + descuento por volumen).
- Foto gratis/colaborativa → acción adecuada (descargar, añadir a mi perfil).
- Ya comprada → descargar / estado "propiedad".
- Fotógrafo viendo las fotos de su propio evento → acciones según rol (eliminar, etiquetar), NO botón de compra.
- Acciones auth-condicionales (favoritos, añadir a mi perfil) → solo usuarios autenticados.
- Invitados → carrito disponible vía guest cart.

**Dónde se usa:** vistas de compra/navegación donde talent o invitado abre una foto — `/events/[code]`, `/dashboard/talent/events/[code]`, la vista de resultados de búsqueda facial IA, y cualquier otra superficie pública/de talent de navegación de fotos. Para el fotógrafo viendo su propio evento (`/dashboard/photographer/events/[id]`), el panel derecho muestra acciones según rol (eliminar, etiquetar) en vez de CTA de compra — o, si es más limpio, el fotógrafo mantiene un tratamiento de detalle distinto. Recomendar el enfoque durante la implementación; el requisito es que el fotógrafo tenga acciones relevantes, no un CTA de compra.

## Criterio de aceptación (Definition of Done)
- [ ] Desktop: el nuevo modal muestra imagen a la izquierda y panel de info/CTA a la derecha (fotógrafo, ubicación, fecha, dimensiones, precio, descuento por volumen, botón primario prominente, compartir/reportar, contador)
- [ ] Mobile: imagen apilada arriba, panel de info/CTA abajo; botón primario prominente y alcanzable con el pulgar; safe-area insets respetados
- [ ] El CTA primario sigue la lógica condicional existente (carrito para pago/no comprada, descargar/añadir-a-perfil para gratis, acciones según rol para fotógrafos) — no hardcodeado
- [ ] Prev/next y controles de teclado funcionan; cerrar vuelve a la galería
- [ ] El lightbox existente queda intacto y sigue usable en otras partes; la lógica compartida de navegación/carga se extrae y reusa en lugar de duplicarse
- [ ] Usado en las vistas de navegación de fotos talent/públicas; el contexto de fotógrafo muestra acciones según rol
- [ ] Reusa componentes de acción y reglas de permiso existentes (sin duplicar, sin acciones hardcodeadas); solo componentes Shadcn existentes (sin nuevas librerías UI)
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión/feature que falla antes y pasa después (lógica del CTA condicional / hooks extraídos)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] Verificado en iOS Safari y Android Chrome reales

## Notas
- **Fuera de alcance:** capa secundaria de zoom a pantalla completa (explícitamente no se quiere); cambiar el set de acciones o sus reglas de permiso (reusar existentes); cambiar la lógica de precio/descuento; eliminar o modificar el lightbox existente (se queda para otros usos); el pipeline de carga de imagen (reusar existente).
- **Punto clave de arquitectura:** la lógica compartida (prev/next, teclado, carga de imagen) probablemente está hoy dentro de `src/components/photo-lightbox.tsx`. Extraerla a hooks/utilidades limpias que ambos componentes consuman; esa extracción es lo que empuja el ticket a >5 archivos y justifica el OpenSpec change.
- **Relación con otros tickets (no bloqueante):** T-060 (paginación de la galería del detalle) toca las mismas 3 vistas de evento — coordinar si se ejecutan cercanos para evitar conflictos. T-009 ya reestiló el lightbox (carrusel/swipe/flechas), buena referencia de la lógica a extraer. El contador "X / Y" reaparece aquí aunque T-009 lo quitó del lightbox — es un panel de compra distinto, no una regresión.
- **Reusar las reglas del CTA:** apoyarse en los componentes de acción y la lógica de permisos ya existentes (mismos que usan las galerías de `/events/[shareCode]` y `/dashboard/talent`), no reinventar la matriz de acciones.
- No es P1 pese a ser "momento de conversión": es una mejora de presentación, no un bug ni un bloqueo; se prioriza P2 por debajo del bug de dorsal en curso.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/two-panel-photo-detail-modal`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
