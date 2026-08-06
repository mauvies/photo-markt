# T-231 · La subida falla en prod con "Object not found" y la foto queda invisible para siempre

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (infra/entornos + estado de datos; la corrección de raíz es config de dashboards, no código)
- **Blockers:** ninguno — pero el **paso 1 exige acceso a los dashboards de Inngest y Vercel** (solo el usuario los tiene)
- **Rama:** `fix/stuck-pending-upload-recovery`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Falló la subida de una foto a un evento en producción con:

```
NonRetriableError: Failed to download photo
30d1f8da-…/8192a562-…/38a29672-….jpg: Object not found
    at … pT.tryExecuteStep … (/var/task/.next/server/…)
```

## Diagnóstico (consultado contra prod, no supuesto)

**El objeto SÍ existe.** El worker dijo "no encontrado" sobre un fichero que está en su sitio:

| | |
|---|---|
| `storage.objects` (prod, bucket `photos`) | creado **07:51:01.053Z**, 258 212 B, `image/jpeg` — **existe** |
| `photos` (prod) | `id c7055587-…`, evento `Cross-Road Huelva`, creado **07:51:01.736Z** (0,7 s después), `size_bytes` 258 212 — **coincide** |
| Estado de la fila | `upload_status='pending'`, `face_index_status='pending'`, `thumbnail_status='pending'` |
| Misma ruta en staging | **0 filas** |
| Histórico de prod | **38 fotos el 2026-07-27: todas `approved` + thumbnail `ready`** · **2026-08-06: 1 foto, atascada** |

O sea: la fila y los bytes están **en prod y son consistentes entre sí**, el pipeline de prod
**funcionaba el 27-jul**, y hoy el worker que consumió `photo.uploaded` **leyó un proyecto Supabase
distinto** de aquel donde se guardó la subida. Es exactamente la causa que el propio código anticipa
en el comentario de `index-photo-faces.ts:428` ("an env mismatch between where the photo was uploaded
and where this worker is running — see T-071"), solo que en producción.

**Hipótesis principal a confirmar (paso 1):** desde **T-137** la integración Vercel↔Inngest
**re-sincroniza el app en cada deploy**. Si un deploy de **preview** (hay varios recientes: PRs
#281–#284) se registró contra el entorno de Inngest de **producción**, los eventos emitidos por prod
se ejecutan en la URL de ese preview, cuyo `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
apuntan a **staging** → `Object not found`. Encaja con la cronología (última subida buena el 27-jul,
antes de la tanda de merges). **No confirmado**: hay que mirar en Inngest qué URL de función tiene
registrada el entorno de producción y a qué proyecto Supabase apunta ese deployment.

⚠️ **Ojo:** solo hay **un** dato posterior al drift y falló. Hasta demostrar lo contrario hay que
asumir que **toda subida a prod está rota ahora mismo**, no que fue una foto con mala suerte.

### Segundo defecto, independiente de la causa raíz y que hay que arreglar igual

Aunque el entorno se corrija, el manejo del fallo está mal:

1. **La foto queda `pending` para siempre.** `onFailure` (`index-photo-faces.ts:276`) marca
   `face_index_status='failed'` y **deja `upload_status` intacto** a propósito — pero el fallo ocurrió
   **antes** del paso que promueve a `approved`, así que nunca se asienta ningún estado terminal. La
   fila es invisible en las galerías (que filtran `approved`) **y** ausente de la pestaña Pendientes
   (que es para moderación), mientras el contador del dashboard sí la cuenta: el síntoma exacto que
   describe T-183.
2. **Bucle de reintentos permanente.** `listStuckPendingOwnerUploads` (`photos.ts:807`) filtra por
   `upload_status='pending'` y **no excluye `face_index_status='failed'`**, así que el reconciliador
   re-emite `photo.uploaded` **cada 30 min, indefinidamente**, para una foto que no puede tener éxito.
   CLAUDE.md afirma que "`failed` photos are left alone… no retry storm" — **esa propiedad no se
   cumple** en la rama (d) de owner-uploads.
3. **Silencio total para el fotógrafo.** No hay aviso, ni estado de error, ni forma de reintentar.

## Criterio de aceptación (Definition of Done)

- [ ] **Paso 1 — confirmar la causa raíz:** verificado en Inngest qué deployment sirve las funciones
      del entorno de producción y contra qué proyecto Supabase resuelve; documentado el hallazgo en el
      PR. Si es el drift de preview→prod, dejar la configuración de forma que un preview **no pueda**
      registrarse en el entorno de producción de Inngest
- [ ] La subida de una foto a un evento de prod termina en `approved` con thumbnail `ready`
      (verificado con una subida real, no solo con tests)
- [ ] Un fallo de descarga **no retriable** deja la foto en un estado **terminal** y visible para el
      fotógrafo (p. ej. `rejected` o un `failed` explícito), nunca en `pending` indefinido
- [ ] El reconciliador **no** re-emite indefinidamente fotos que ya agotaron reintentos: la propiedad
      "una foto `failed` se deja en paz" pasa a cumplirse también para owner-uploads (y CLAUDE.md se
      corrige si el comportamiento final difiere de lo que hoy afirma)
- [ ] El fotógrafo ve que esa foto falló y puede reintentarla o borrarla
- [ ] **Recuperada la foto ya afectada** (`c7055587-…`, evento `Cross-Road Huelva`): sus bytes están
      intactos en prod, así que debe poder quedar `approved` sin volver a subirla
- [ ] Strings nuevos en `en.json` y `es.json` (si hay UI de error)
- [ ] Test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- **Descartado:** carrera entre el PUT y el insert. El objeto es **0,7 s anterior** a la fila, y el
  evento se emite después del insert. Tampoco es el cron de huérfanos (`cleanup-orphaned-storage`,
  guarda de 1 h) — el objeto sigue vivo, no fue barrido. Tampoco es una subida masiva: el evento
  tiene **una sola foto**.
- **No hay más fotos atascadas en prod** (0 filas `pending` con más de 1 h). El daño de datos actual
  es una foto; el riesgo es que se repita en cada subida.
- `attachPhotosToEvent` inserta la fila confiando en que el cliente reporta el PUT como exitoso; aquí
  el cliente acertó (el objeto existe), así que **no** es el problema — pero conviene anotarlo por si
  al arreglar el estado terminal se quiere verificar existencia antes de insertar.
- **P1 y no P0** porque prod aún no tiene usuarios reales, así que no hay pérdida de ingresos ni de
  datos de terceros; va **primero** en la cola porque es la acción central del fotógrafo, falla en
  silencio y bloquea las propias pruebas del usuario en producción.
- Contexto relacionado ya archivado: **T-137** (integración Vercel↔Inngest, que es lo que introduce el
  re-sync por deploy), **T-125/T-138** (el drift anterior y su reconciliación), **T-183** (el
  reconciliador de owner-uploads que aquí entra en bucle), **T-071** (el mismatch de entornos en local).

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
