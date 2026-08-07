# T-241 · Guardar el perfil muestra un error falso «NEXT_REDIRECT» antes de guardar bien

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `fix/profile-form-swallows-next-redirect`  (tipo = fix)
- **OpenSpec change:** —  (un componente + un comentario; no llega al umbral)
- **PR:** #292

## Requerimiento

Reportado por el usuario: al editar el perfil y guardar, **aparece brevemente una alerta de error que
dice `NEXT_REDIRECT`** y acto seguido los cambios se guardan y se muestra el perfil actualizado en
`/dashboard/photographer/profile/preview`.

**Causa raíz localizada — no hace falta reproducir a ciegas.** El formulario es
`src/components/profile-form.tsx:60-76`:

```ts
try {
  const parsed = profileSchema.parse(value);
  await onSubmit(parsed);      // ← updateProfileAction
  router.refresh();
} catch (error) {
  if (error instanceof z.ZodError) { … }
  else setSubmitError(error instanceof Error ? error.message : 'Failed to update profile');
}
```

`updateProfileAction` termina en `localizedRedirect(lang, '/dashboard/photographer/profile/preview')`
(`dashboard/photographer/profile/update-action.ts:69`), y **`redirect()` en Next se implementa
lanzando** una excepción especial (`NEXT_REDIRECT`). Ese `catch` genérico la atrapa como si fuera un
fallo del guardado y pinta `error.message` — literalmente `NEXT_REDIRECT` — en el banner de error. El
guardado **ya había ocurrido** (el redirect es la última línea de la acción) y el router de Next
completa la navegación de todos modos, así que el banner aparece y desaparece: exactamente el
«por un momento muy breve» del reporte.

Dicho de otra forma: **no hay ningún error**. Se le está enseñando al usuario el mecanismo interno de
un guardado correcto, con la palabra «error» delante.

## Criterio de aceptación (Definition of Done)

- [ ] Guardar el perfil de fotógrafo no muestra ningún banner de error en ningún momento; navega a
      `/dashboard/photographer/profile/preview` con los cambios aplicados
- [ ] El `catch` deja de tragarse las excepciones de control de flujo de Next — usar
      **`unstable_rethrow`** de `next/navigation` (existe en el Next instalado, 16.2.10) como primera
      línea del `catch`, que es la API oficial para esto y cubre también `notFound()`/`forbidden()`,
      no solo `redirect()`
- [ ] **No se rompe la ruta de talento**: `ProfileForm` es compartido y
      `dashboard/talent/settings/profile` + `dashboard/talent/profile` lo usan con acciones que **no**
      redirigen y que sí dependen del `router.refresh()` posterior. Ese camino debe seguir refrescando
      igual (regresión a cubrir con test)
- [ ] Los errores reales siguen mostrándose: `Username is already taken` y `User not authenticated`
      (los dos `throw` de `update-action.ts`) siguen llegando al banner
- [ ] Corregido el comentario de `update-action.ts:63-67`, que hoy describe el bug como si fuera el
      diseño («`localizedRedirect` throws the Next.js NEXT_REDIRECT exception, which the form's submit
      handler will surface to React») — es justo lo que no debe pasar
- [ ] Barrido: comprobar si algún otro formulario cliente hace `await <server action que redirige>`
      dentro de un `try/catch` genérico y arrastra el mismo síntoma. Si los hay, se arreglan aquí; si
      no hay ninguno, se dice en el PR (no enumerados todavía en la captura de este ticket)
- [ ] Test de regresión que falla antes y pasa después: submit cuya acción lanza un error con forma de
      redirect de Next ⇒ **no** se pinta banner y la excepción se re-lanza; submit cuya acción lanza un
      `Error` normal ⇒ sí se pinta
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Por qué P2 y no P1:** no se pierde nada — el guardado se completa y el usuario acaba viendo su perfil
actualizado. Pero es un mensaje de error **falso** en una operación que salió bien, que es de las cosas
que más rápido erosionan la confianza en el producto, y el arreglo es de una línea más su test. Si al
hacer el barrido aparece la misma forma en una ruta de pago o de subida, ese hallazgo sí sube de
prioridad.

Detalle de navegación por si alguien busca la pantalla: el formulario vive en
`dashboard/photographer/settings/profile`; `dashboard/photographer/profile/edit` es solo un
`redirect()` legacy hacia ella, y `profile/preview` es el destino al guardar — de ahí que el usuario lo
reporte sobre la URL de preview.

Adyacente y **fuera de alcance** (no tocar aquí): `updateProfileAction` comprueba la unicidad del
username con un `select` previo en vez de apoyarse en la restricción única, lo que es una carrera; y
lanza `Error` en vez de devolver un resultado tipado, con el caveat conocido de T-189 (Next redacta los
mensajes lanzados desde Server Actions en producción, así que «Username is already taken» probablemente
no se lea tal cual en prod). Si se quiere cerrar eso, merece su propio ticket.

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
