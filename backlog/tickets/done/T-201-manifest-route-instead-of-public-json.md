# T-201 · Manifiesto PWA: `public/manifest.json` → `src/app/manifest.ts` (MetadataRoute.Manifest)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `refactor/manifest-metadata-route`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** #277

## Requerimiento
Refactorizar la configuración del manifiesto para seguir la práctica oficial de Next.js App Router:
en vez de un JSON estático en `public/` enlazado a mano desde `metadata`, generarlo con el file
convention `manifest.ts` tipado con `MetadataRoute.Manifest`.

1. **Eliminar** `public/manifest.json`.
2. **Crear** el `manifest.ts` con esta configuración (la que dio el usuario):

```typescript
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Photo Markt',
    short_name: 'Photo Markt',
    description: 'Find yourself in every photo',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
```

## Ajustes al enunciado por cómo está montado ESTE repo (verificado, no supuesto)
El usuario escribió `app/manifest.ts` y `app/layout.tsx`; aquí las rutas reales son otras y hay dos
efectos colaterales que el enunciado no cubre. Decidir en el PR, no silenciosamente:

1. **Ruta del archivo: `src/app/manifest.ts`** — el repo usa `src/app/` y el manifiesto debe vivir en la
   **raíz de `app`**, NO dentro del segmento `[lang]` (junto a `robots.ts` y `sitemap.ts`, que ya siguen
   ese patrón). Se sirve en `/manifest.webmanifest`, fuera del prefijo de locale.
2. **`manifest: '/manifest.json'` en `src/app/layout.tsx:53` queda stale** — apunta al archivo que se
   borra. Next **inyecta solo** el `<link rel="manifest" href="/manifest.webmanifest">` cuando existe
   `manifest.ts`, así que la propiedad debe **eliminarse** del objeto `metadata` (preferido) o
   actualizarse a `/manifest.webmanifest`. Dejarla como está = link roto (404) en todas las páginas.
3. **`orientation: 'portrait'` se pierde** — el `public/manifest.json` actual lo tiene y la config
   propuesta no. Confirmar si es intencional; si lo es, decirlo en el PR (afecta cómo abre la PWA
   instalada). El resto de campos son idénticos al JSON actual.
4. **`public/site.webmanifest` es un segundo manifiesto huérfano y roto**: `name`/`short_name` vacíos e
   iconos apuntando a `/android-chrome-*.png` en la raíz, que **no existen** (los reales están en
   `/favicon/`). Nada en `src/` lo referencia. Proponer borrarlo en el mismo PR (misma limpieza); si el
   usuario lo quiere conservar, dejarlo y anotarlo.
5. **Middleware: sin problema, ya verificado.** El matcher de `src/proxy.ts:145` excluye cualquier path
   con extensión (`.*\..*`), así que `/manifest.webmanifest` no entra al rewrite de locale. No tocar el
   matcher.

## Criterio de aceptación (Definition of Done)
- [x] `public/manifest.json` eliminado; existe `src/app/manifest.ts` tipado con `MetadataRoute.Manifest`
- [x] `GET /manifest.webmanifest` devuelve 200 con `content-type: application/manifest+json` y el JSON
      esperado (nombre, iconos, `start_url`, `scope`, `display`, colores) — verificado contra la salida
      del build (`.next/server/app/manifest.webmanifest.{body,meta}`); la ruta prerenderiza estática
- [x] Ninguna página emite ya un `<link rel="manifest">` apuntando a `/manifest.json` (404); el link
      inyectado por Next apunta a `/manifest.webmanifest`
- [x] Los dos iconos referenciados existen en `public/favicon/` (192 y 512) — asertado por el test
- [x] Decisión sobre `orientation` y sobre `public/site.webmanifest` declarada en el PR
- [x] strings nuevos en `en.json` y `es.json` (N/A — el manifiesto no pasa por el sistema de diccionarios)
- [x] test de regresión que falla antes y pasa después (`test/unit/src/app/manifest.test.ts`, 2 rojos → 5 verdes)
- [x] `pnpm typecheck && pnpm lint && pnpm build` en verde; unit verde salvo los 2 fallos preexistentes
      ajenos de `main` (skeletons T-128/T-156). Integración no corrida: Docker no disponible y el
      cambio no toca BD

## Resolución
1. **`orientation: 'portrait'` se conserva** — la config del enunciado lo omitía, pero perderlo cambia
   cómo abre la PWA instalada; un refactor no debe cambiar comportamiento.
2. **`public/site.webmanifest` borrado** — huérfano y roto, sin referencias en `src/`.
3. `manifest` eliminado del objeto `metadata` en `src/app/layout.tsx` (opción preferida del enunciado):
   Next inyecta el link solo si existe la convention.
4. `src/proxy.ts` no se tocó (el matcher ya excluye paths con extensión).

## Notas
- Test sugerido: unit sobre el default export de `src/app/manifest.ts` (campos requeridos + iconos con
  los `purpose` correctos) + guard source-level de que `src/app/layout.tsx` ya no referencia
  `/manifest.json` y de que `public/manifest.json` no existe. Rojo antes / verde después.
- **El manifiesto no está localizado** ni antes ni después de este cambio (`name`/`description` en inglés
  para ambos locales). No es regresión; si se quiere localizar, es su propio ticket.
- Correr `pnpm build` además de typecheck: los file conventions de `app/` solo se resuelven al buildear
  (memoria `build-catches-client-graph-errors`).
- Cambio aislado, reversible, sin superficie de pagos/auth/BD → sin OpenSpec y sin `/code-review`.
