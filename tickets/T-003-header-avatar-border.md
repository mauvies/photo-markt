# T-003 · Borde fino en el avatar del header

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/header-avatar-border`
- **OpenSpec change:** —  (cambio chico de UI, 1 archivo)
- **PR:** —

## Requerimiento
El avatar de usuario del header debe tener un borde fino grisáceo rodeando el círculo, igual que el
del language toggler. Así, si el avatar tiene fondo blanco, queda contenido dentro de un círculo con borde.

## Criterio de aceptación (Definition of Done)
- [ ] Avatar del header con borde fino gris, mismo estilo/color que el del language toggler
- [ ] Se ve bien tanto con avatares de fondo blanco como con foto
- [ ] Sin cambios funcionales
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Reutilizar el mismo token de borde que el language toggler (T-002) para mantener consistencia.
- Solo estilos (Tailwind/shadcn). Sin strings nuevos → no toca `en.json` / `es.json`.
- Relacionado con T-002 (ambos son polish del header); si se ejecutan seguidos, alinear el valor del borde.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/header-avatar-border`.
2. Cambio chico de UI → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/header-avatar-border`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
