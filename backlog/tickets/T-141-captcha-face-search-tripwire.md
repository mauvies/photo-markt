# T-141 · [TRIPWIRE] CAPTCHA en la búsqueda facial anónima — revisitar al subir el cap global

- **Prioridad:** P2
- **Estado:** blocked
- **Blockers:** **tripwire** — revisitar SOLO cuando se suba el **cap global de T-034** para un evento real (más exposición ⇒ el CAPTCHA empieza a pagar su fricción). No accionar antes.
- **Rama:** `feat/face-search-captcha` (cuando se accione)
- **OpenSpec change:** **sí** (cuando se accione) — control de seguridad + UX en el path anónimo.
- **PR:** —

## Requerimiento / por qué está diferido
El CAPTCHA (p.ej. **Cloudflare Turnstile**) es el control que **de verdad rompe la automatización** del abuso de
búsqueda facial — los límites por IP **no**, porque las IPs rotan trivialmente vía proxies residenciales.

Se **difiere a propósito** (no se implementa en [[T-034]]): con el circuit breaker global de T-034 puesto bajo,
la exposición máxima es ~$2/día, que **no justifica** la fricción de UX; además **no hay usuarios aún** a quienes
molestar si el breaker salta. Pre-construir un CAPTCHA flagueado-off sería **código sin usar**.

## Condición de disparo (tripwire)
Accionar este ticket cuando **se suba el cap global de T-034** para acomodar un evento real (p.ej. una carrera de
cientos de corredores). Un breaker más alto = más exposición → en ese punto el CAPTCHA empieza a pagar su
fricción. Registrar aquí para que la decisión **se revisite en vez de olvidarse**.

## Criterio de aceptación (cuando se accione)
- [ ] Decisión tomada y documentada: implementar CAPTCHA vs. mantener solo el breaker (con el cap ya subido).
- [ ] Si se implementa: prueba de humanidad (Turnstile u equivalente) en el path de búsqueda facial anónima,
      sin romper la búsqueda por dorsal ni el resto de la app; selfie efímera respetada; strings en en/es.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Dependencia conceptual de [[T-034]] (el breaker y su cap configurable existen primero).
- No pre-construir mientras el tripwire no se cumpla — este ticket existe para **no olvidar** la decisión.
