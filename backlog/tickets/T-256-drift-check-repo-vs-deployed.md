# T-256 · Deriva entorno↔repo: nada comprueba que lo desplegado sea lo que dice el repo

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** normal  (script de ops, solo lectura — no toca el código de la app)
- **Blockers:** ninguno
- **Rama:** `chore/ops-drift-check`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Los fallos más caros del proyecto no fueron bugs de código: fueron **el repo y producción diciendo
cosas distintas**, sin que nada lo comprobara. Los cuatro están en las notas de sesión:

1. **Webhook de Stripe muerto** — el endpoint apuntaba al ápex, que 307-redirige, y Stripe no sigue
   redirects. Todas las entregas muertas hasta el 2026-07-28 (T-192).
2. **Inngest con 5 de 13 funciones sincronizadas** en producción → thumbnails, dorsales y crons
   muertos, sin señal (T-125).
3. **Migración nunca aplicada** — `migrate.yml` se quedó sin minutos de Actions, falló en el setup
   (~3 s) y el merge tumbó producción (2026-07-17).
4. **Migración ya aplicada, luego editada** — el fichero cambió, el registro no, y esa columna no
   llegó nunca a ese entorno (staging sin `bundle_all_photos_cents`, T-204).

Quiero un comando que responda a eso de una vez, en verde o rojo:

```
pnpm ops:drift
```

## Criterio de aceptación (Definition of Done)

- [ ] `pnpm ops:drift` imprime una tabla por entorno (staging · prod) con el estado de cada
      comprobación y sale con código ≠ 0 si alguna falla
- [ ] **Migraciones:** ficheros en `supabase/migrations/` vs registradas en el entorno — detecta
      tanto las que faltan como las **registradas con un hash distinto** (el caso 4)
- [ ] **Inngest:** nº de funciones registradas en `/api/inngest` vs synceadas en el entorno
- [ ] **Webhook de Stripe:** el endpoint configurado responde `200` (no `307`) al host que tiene puesto
- [ ] Solo lectura: no aplica migraciones, no re-sincroniza, no reconfigura nada — reporta
- [ ] Documentado en la tabla de comandos de `CLAUDE.md`
- [ ] `pnpm typecheck && pnpm lint` en verde

## Notas

**Por qué un script y no un cron todavía:** la programación es una decisión aparte y más barata de
tomar una vez existe el chequeo. Opciones, para cuando toque: agente Claude programado (tiene repo +
MCP Supabase + `gh`, puede correr las tres), o GitHub Actions — ⚠️ ojo, el plan Free se quedó sin
minutos en julio 2026 y **ese fue justamente el incidente 3**, así que Actions no es un vigilante
fiable aquí.

**Por qué no va dentro de la app:** dos de las tres comprobaciones son auto-referenciales (Inngest no
puede reportar de forma fiable que Inngest no está synceado) y una necesita leer el repo.

Refs de proyecto: `scripts/check-supabase-advisors.ts` es el precedente de script de ops con salida
roja/verde; `pnpm advisors:check` ya cubre los avisos de seguridad de Supabase y **no** hace falta
duplicarlo aquí.
