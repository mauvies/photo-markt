# T-031 · Enlaces a Términos y Privacidad en el aviso de /signup (y corregir copy)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (destinos `/terms` y `/privacy-policy` ya existen — T-021 y T-016 mergeados)
- **Rama:** `fix/signup-legal-links`
- **OpenSpec change:** —  (UI + i18n acotado, un archivo + diccionarios)
- **PR:** —

## Requerimiento
En la página `/signup`, el texto de consentimiento ("Al continuar, aceptas…") debe enlazar a **nuestras**
páginas de **Términos** (`/terms`) y **Política de privacidad** (`/privacy-policy`). Hoy es texto plano sin
enlaces.

## Estado actual (verificado)
- `src/app/[lang]/signup/page.tsx:186` renderiza `dict.signup.termsNotice` como `<p>` plano, **sin enlaces**.
- ⚠️ **Copy incorrecta (bug):** el texto actual dice que aceptas los términos/privacidad **de Supabase**:
  - EN: *"By continuing, you agree to **Supabase's** Terms of Service and Privacy Policy, and to receive periodic emails with updates."*
  - ES: *"Al continuar, aceptas los Términos de servicio y la Política de privacidad **de Supabase**, y recibirás correos periódicos con actualizaciones."*
  Es boilerplate; debe referirse a **Photo Markt**, no a Supabase.
- Las páginas destino ya tienen contenido real: `/privacy-policy` (T-016) y `/terms` (T-021), enlazadas con
  `localizedPath(lang, ...)` desde el footer.

## Criterio de aceptación (Definition of Done)
- [ ] En `/signup`, "Términos de servicio" y "Política de privacidad" son **enlaces** a
      `localizedPath(lang, '/terms')` y `localizedPath(lang, '/privacy-policy')` respectivamente
- [ ] La copy referencia a **Photo Markt** (no "Supabase"); revisar también la cláusula de "correos periódicos"
      y dejarla solo si es cierta (si no se envían marketing emails al registrarse, quitarla o ajustarla)
- [ ] Implementado con i18n (sin texto hardcodeado): partir `termsNotice` en segmentos + labels de enlace
      (p. ej. `termsNoticePrefix`, `termsLinkLabel`, `privacyLinkLabel`, conectores) en `en.json` **y** `es.json`,
      o el patrón que mejor encaje, evitando concatenación frágil que rompa el orden de palabras en ES
- [ ] Enlaces accesibles (subrayado/hover como el resto de enlaces legales), abren la página correcta por idioma
- [ ] Se ve bien en mobile y desktop, en ambos idiomas
- [ ] Test que verifique que el aviso de signup contiene enlaces a `/terms` y `/privacy-policy` (o paridad es/en de
      las nuevas claves): falla antes, pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Cuidado con el orden de palabras ES≠EN**: no concatenar a mano `prefijo + LINK + sufijo` si rompe la frase en
  español. Considerar un render con 2 enlaces incrustados en una frase traducida (p. ej. plantilla con
  placeholders, o segmentos pensados para ambos idiomas).
- Revisar si `/login` u otras vistas de auth tienen el mismo aviso (no se encontró en `/login`, pero confirmar al
  ejecutar) para mantener consistencia.
- Alcance pequeño pero es **corrección legal** en el punto de creación de cuenta — vale ejecutarlo pronto.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/signup-legal-links`.
2. Acotado → implementar directo (sin OpenSpec).
3. Enlazar Términos/Privacidad + corregir copy + i18n (en+es) + test.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin fix/signup-legal-links`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
