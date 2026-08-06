# T-238 · `FUNCTION_PAYLOAD_TOO_LARGE` al subir la portada — los bytes viajan por una Server Action y Vercel corta a 4,5 MB

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** normal  (subidas + config de plataforma; no toca pagos, auth ni BD)
- **Blockers:** ninguno
- **Rama:** `fix/server-action-payload-too-large`  (tipo = fix)
- **OpenSpec change:** — (decidir al ejecutar: si se hacen las 3 superficies de una, probablemente sí)
- **PR:** —

## Requerimiento

Reportado por el usuario en producción, al subir una **foto de portada** desde la página de editar evento:

```
Request Entity Too Large
FUNCTION_PAYLOAD_TOO_LARGE
cdg1::6kvzr-1786019424385-ed41a1828fa2
```

Es un error **de plataforma de Vercel**, no de la app: la respuesta es un 413 de Vercel, así que ni
siquiera llega al `catch` del formulario y el usuario ve el texto crudo en vez del toast
`coverUpdateFailed` que el código sí tiene preparado (`edit-event-form.tsx:174-179`).

**Causa raíz (verificada en código):** `uploadEventCoverAction`
(`dashboard/photographer/events/new/actions.ts:457`) recibe el archivo **dentro de un `FormData` de una
Server Action** — `edit-event-form.tsx:171` hace `formData.append('cover', file)` — o sea que los bytes
completos atraviesan la función serverless. **Vercel impone un tope duro de 4,5 MB al cuerpo de una
función**, y ese límite **no se puede subir por configuración**.

**Por qué no se detectó antes:** `next.config.ts:16` declara `serverActions.bodySizeLimit: '500mb'`. En
local eso funciona de verdad, así que la portada sube sin problema; en Vercel el 4,5 MB gana igualmente.
La config no está "mal" — es que **promete algo que la plataforma no cumple**, y esa divergencia
local↔prod es exactamente lo que dejó pasar el bug. La validación de la app tampoco ayuda: la portada
pasa por `validatePhotoUpload`, cuyo tope es **50 MB**, así que la app anuncia 50 MB y la plataforma
rechaza a 4,5.

**La app ya tiene la solución, la portada simplemente no la usa.** Las fotos normales **no** sufren esto
porque suben **directas del navegador a Supabase Storage con signed upload URLs**
(`events/[id]/upload-urls/actions.ts:402` → `createSignedUploadUrls`), sin pasar por la función. La
portada es la excepción.

### Dos superficies más con el mismo defecto (encontradas al verificar esta)

No las reportó el usuario, pero son **el mismo bug** y arreglar solo la portada dejaría dos vivas:

| Superficie | Acción | Tope que declara | Realidad en Vercel |
|---|---|---|---|
| Portada de evento | `uploadEventCoverAction` | 50 MB (`validatePhotoUpload`) | 4,5 MB |
| **Avatar** | `updateAvatarAction` (`actions/avatar.ts:89`) | 8 MB (`MAX_AVATAR_BYTES`) | 4,5 MB |
| **Selfie de búsqueda facial** | `searchFacesInEvent` (`events/[shareCode]/actions.ts:331`) | 10 MB | 4,5 MB |

La del **selfie es la más dañina de las tres** aunque nadie la haya reportado: está en el camino del
**comprador**, es la función estrella (AI photo search), y una foto de móvil moderno pasa de 4,5 MB con
facilidad — o sea que un porcentaje de atletas ve fallar «encuentra mis fotos» sin que quede rastro en el
backlog. Nota además que **AWS Rekognition acepta como mucho 5 MB de bytes de imagen** en
`SearchFacesByImage`, así que aceptar 10 MB nunca pudo funcionar de extremo a extremo.

## Criterio de aceptación (Definition of Done)

- [ ] **Portada (el bug reportado):** los bytes dejan de atravesar la Server Action — subida directa a
      Storage con signed upload URL, reutilizando el patrón que ya existe en
      `events/[id]/upload-urls/actions.ts`; la acción pasa a recibir la **ruta** ya subida y a hacer
      validación + `setEventCoverPath`
- [ ] ⚠️ **No se pierde la validación por magic bytes.** Hoy `validatePhotoUpload` es lo que impide que
      un `.exe` renombrado acabe en el bucket; con subida directa esa comprobación ya no puede correr
      antes del upload, así que hay que decidir y documentar dónde vive (validar el objeto ya subido y
      borrarlo si no pasa, como hace el worker con `upload_status='rejected'`, es el patrón que el repo
      ya usa para las fotos)
- [ ] **Avatar:** mismo tratamiento, o bajar `MAX_AVATAR_BYTES` por debajo del tope real y decirlo en la
      UI — pero **no** dejar declarado un tope que la plataforma no honra
- [ ] **Selfie:** reducir en el cliente antes de enviar (una búsqueda facial no necesita 10 MB, y
      Rekognition no acepta más de 5 MB de todos modos), o subir por signed URL
- [ ] `next.config.ts` deja de declarar `bodySizeLimit: '500mb'` sin más: o se baja a un valor que Vercel
      pueda cumplir, o se deja con un comentario que diga explícitamente que **en Vercel manda el 4,5 MB**
      y por qué el valor alto solo sirve en local — hoy induce a error a quien lo lea
- [ ] El fallo por tamaño se presenta como **error de la app, no de Vercel**: comprobar el tamaño en el
      cliente antes de enviar y mostrar copia localizada con el límite real
- [ ] Strings nuevos en `en.json` y `es.json`
- [ ] Test de regresión que falle antes y pase después (p. ej. que la acción de portada ya no acepte un
      `File` crudo, y/o el guardia de tamaño en cliente)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Se puede partir en dos si el PR crece**: portada + avatar (superficies del fotógrafo, mismo arreglo de
signed URL) por un lado, y selfie por otro (arreglo distinto — reducción en cliente). Se dejan juntas
porque comparten **una sola causa raíz** y porque el hallazgo valioso es el patrón, no cada instancia:
*ninguna Server Action debería transportar bytes de imagen en producción*. Si se arregla solo la
portada, conviene dejar las otras dos fichadas antes de cerrar.

**Prioridad P1** y no P2 porque es un bug **de producción ya reportado** que bloquea una función
documentada (portada de evento, T-055/T-166), y porque la misma causa degrada en silencio el camino del
comprador. No es P0 porque hay workaround inmediato para el fotógrafo (subir una imagen más pequeña) y no
hay pérdida de datos ni de dinero.

**Comprobado que NO está afectado:** la subida de fotos del fotógrafo y la de invitados, que ya van por
signed upload URL directas a Storage. Ese es justo el patrón a copiar.

Contexto: `edit-event-form.tsx:163-181`, `dashboard/photographer/events/new/actions.ts:457`,
`app/[lang]/actions/avatar.ts:89`, `app/[lang]/events/[shareCode]/actions.ts:331`, `next.config.ts:13-18`,
`src/lib/photo-upload.ts` (tope de 50 MB), `events/[id]/upload-urls/actions.ts` (el patrón bueno).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
