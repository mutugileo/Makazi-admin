# PropAdmin Agent Rules & Guidelines

`PropAdmin` is the landlord and property manager portal for Makazi, built with **Astro 5 (SSR)**, **Tailwind CSS**, and **Supabase**, deployed to **Vercel Edge**.

---

## Architecture & Conventions

### 1. Multi-Tenancy & Authorization
- Every authenticated request sets `Astro.locals.user` with `{ email, name, companyId, role }`.
- Always fetch data using `getPortfolio(Astro.locals.user.companyId, Astro.cookies)`.
- Never bypass `companyId` filtering in API endpoints under `src/pages/api/`.

### 2. Viewport & Table Layout Rules
- **No trapped scrollbars**: Never wrap data tables or ticket lists in fixed/clamped heights like `max-h-[calc(100vh-320px)]`. Tables must expand naturally in the DOM.
- **Sticky Actions**: The last column ("Action" or "Outstanding") must always be sticky right (`sticky right-0 z-10`) with `bg-white/95 backdrop-blur-xs` and a subtle drop shadow (`shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.05)]`).
- **Compact Action Controls**: Use icon buttons (e.g. `<KeyRound />`) with clear tooltips rather than multiple wide text buttons to keep action column widths under 200px.
- **Dialog & Modal Sizing**: Root dialog card must use `max-h-[90vh]` or `max-h-[92vh] flex flex-col`. Form/body contents must use `flex-1 min-h-0 overflow-y-auto` so action footers remain accessible on screens with only ~550px viewport height.

### 3. Astro SSR State & Transitions
- Client scripts must reinitialize on `astro:page-load`:
  ```ts
  document.addEventListener('astro:page-load', initPage);
  ```
- Use `data-bound="true"` guards on elements to prevent duplicate event listeners on view transitions.

### 4. Verification Before Shipping
Before submitting any admin changes:
```sh
npm run build
```
Ensure 0 build errors and no bundling warnings.
