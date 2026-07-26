# T-182 · Permitir cambiar la foto de perfil (fotógrafo y talento)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (requiere migración nueva — ver Notas; no bloquea la captura)
- **Rama:** `feat/change-profile-picture`  (tipo = feat)
- **OpenSpec change:** —  (probable **sí**: toca upload/storage/migración + 2 settings + propagación → >1 archivo y superficie sensible; decidir al ejecutar)
- **PR:** —

## Requerimiento
Los usuarios necesitan poder **subir/cambiar su foto de perfil (avatar)** desde ajustes, para **ambos roles** (fotógrafo y talento). El flujo de subida es idéntico según el rol → **un solo componente compartido**.

**Modo de ejecución: normal, NO fully-autonomous** — toca **subida de archivos** (superficie de abuso) y storage. El reviewer debe confirmar que la validación server-side de tipo/tamaño **rechaza de verdad** un no-imagen y un archivo oversized.

## Lo que YA existe (reporte previo — pedido por el usuario, verificado en código)
- **Columna `profiles.avatar_url` (TEXT)** — ya existe (`migrations/20260701000000_restore_profiles_slug_avatar.sql`), **backfilled desde el metadata de Google OAuth** (`raw_user_meta_data->>'avatar_url'`). Hoy es una **URL completa** (de Google), no un path de storage.
- **Render del avatar YA cableado** en muchas superficies vía shadcn `Avatar/AvatarImage/AvatarFallback` (`src/components/ui/avatar.tsx`): header dropdown (`user-avatar.tsx`, `dashboard-user-menu.tsx`), perfil público del fotógrafo (`photographer-public-profile.tsx`, `photographer-profile-header.tsx`), event cards (`event-card.tsx`), bottom-navs, sidebar, etc. Todos leen `profiles.avatar_url` y lo pasan como `src`.
- **Default/placeholder YA existe:** `AvatarFallback` (iniciales/ícono) cuando `avatar_url` es null → "quitar avatar" = poner `avatar_url = null` y cae al fallback. No hace falta inventar un default.
- **Settings de ambos roles existen:** `dashboard/photographer/settings/profile/page.tsx` y `dashboard/talent/settings/profile/page.tsx` (hoy solo `page.tsx` cada uno) — ahí va el control.
- **Pipeline de imagen reutilizable:** `src/lib/photo-upload.ts` (`validatePhotoUpload` — magic bytes vía Sharp, cap 50 MB, deriva tipo/extensión reales) y `src/lib/thumbnails.ts` (`generateThumbnail(buffer, size)` → resize `fit:'inside'` + `.webp({quality:80})`). Sirven para validar + resize del avatar.

**Conclusión:** NO hay que construir el sistema de avatar completo — **falta solo la capacidad de CAMBIARLO** (subir/reemplazar/quitar). Pero sí faltan dos piezas de infra (ver Notas): **bucket de avatars** y **cleanup del anterior**.

## Criterio de aceptación (Definition of Done)
1. [ ] Fotógrafo **y** talento pueden **subir/cambiar** su foto de perfil desde settings, vía **un componente compartido** (mismo flujo para ambos roles).
2. [ ] El nuevo avatar **se propaga a todas las superficies** donde se muestra (header dropdown, perfil público, sección del fotógrafo en event cards, bottom-nav, etc.), no solo en settings — invalidar/revalidar los caches y tags correspondientes.
3. [ ] **Validación server-side de tipo y tamaño** en la Server Action: solo imágenes (jpeg, png, webp) vía magic bytes (no confiar en el `accept` del cliente); cap de tamaño (unos pocos MB); no-imágenes y oversized **rechazados con mensaje claro** (localizado).
4. [ ] Las imágenes subidas se **redimensionan/comprimen a dimensiones de avatar** (no se guarda el raw) — reusar `generateThumbnail`/Sharp (WebP). Decidir `fit` (`cover` para recorte cuadrado vs `inside`).
5. [ ] El avatar **anterior no queda huérfano** en storage al reemplazar (**delete-on-replace** — ver Notas: el cron de orphan-cleanup actual NO cubre un bucket nuevo de avatars).
6. [ ] (Opcional) **Quitar avatar** → `avatar_url = null` → cae al `AvatarFallback` existente; también limpia el objeto de storage.
7. [ ] **UX:** update **optimista** donde tenga sentido con **toast de fallo** (patrón del carrito) + **loading state** durante la subida.
8. [ ] Funciona en **mobile y desktop**.
9. [ ] Mutaciones vía **Server Actions** (no API routes).
10. [ ] strings nuevos en `en.json` y `es.json`.
11. [ ] test de regresión/feature que falla antes y pasa después (la validación rechaza no-imagen y oversized; la action escribe `avatar_url` y borra el objeto viejo).
12. [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
13. [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Bucket de storage (decisión clave):** hoy el **único bucket es `photos`** — **privado**, RLS scoped a `auth.uid()/…`, servido vía signed URLs. Los avatares se renderizan **directo como `<img src>` en páginas públicas**, así que necesitan lectura pública. Opciones: **(A)** nuevo bucket **público** `avatars` (recomendado — estándar, `avatar_url` guarda la public URL; simple) con RLS de escritura scoped al owner (`name ~~ auth.uid()/…`, tipo/tamaño enforced como el bucket `photos` en `remote_schema.sql:848`); **(B)** reusar `photos` privado + signed URLs de larga vida en cada render (más complejo, peor cache). → **Migración nueva** para el bucket + policies. (Ojo memoria: las migraciones se aplican vía **GitHub Action en merge a main**, no Vercel — coordinar.)
- **Cleanup del avatar anterior:** el cron `cleanup-orphaned-storage.ts` está scopeado al bucket **`photos`** (reconcilia objetos vs filas `photos`), **no** cubriría un bucket `avatars` nuevo → este ticket debe **borrar el objeto anterior en el propio reemplazo** (delete-on-replace en la action), no delegar al cron. Alternativa: extender el cron, pero delete-on-replace es más simple y determinista.
- **`avatar_url` mixto (Google URL vs storage):** hoy apunta a Google. Tras subir, apuntará al bucket. El render ya es agnóstico (solo pasa la string como `src`), así que ambos coexisten sin cambios en los consumidores. No migrar los existentes.
- **Reuso:** `validatePhotoUpload` (magic bytes + cap) + `generateThumbnail` (resize→WebP). Si el cap de avatar (unos MB) difiere del 50 MB de fotos, parametrizar sin romper el call-site de fotos.
- **Propagación / caché:** identificar los tags/paths a revalidar (perfil público del fotógrafo, event cards que muestran su avatar, header). El header client-side lee del user/profile — asegurar que refresca (router.refresh / revalidate).
- **Fuera de alcance:** cambiar otros campos de perfil, cropper interactivo avanzado (a menos que trivial), avatar de admin.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/change-profile-picture`.
2. Si aplica, `/opsx:propose` para generar el change (probable aquí: upload + storage + migración).
3. Implementar + test de regresión (CLAUDE.md lo exige) — incluir el rechazo de no-imagen/oversized.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` — el reviewer confirma que la validación server-side rechaza un no-imagen y un oversized; aplicar la migración del bucket al mergear.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
