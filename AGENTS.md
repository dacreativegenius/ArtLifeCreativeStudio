# Vibe Vite Template — Agent Instructions

Client-only Vite web app. **Default** files **blank** — agents build from scratch per prompt. Optional stacks (Three.js, p5, etc.) added only when needed. No md files.

---

## Structure

```
├── apps/
│   ├── vite/                 ← Web app (React DOM + Vite)
│   │   ├── client/
│   │   │   ├── pages/        ← Route components — add pages here
│   │   │   ├── components/   ← Screens, hooks — implement here
│   │   │   ├── App.tsx       ← Register routes
│   │   │   ├── main.tsx, global.css
│   │   │   └── lib/          ← Optional local helpers
│   │   └── package.json      ← Scripts: `add:three-r18`, `add:p5`
└── packages/
    ├── ui/         ← @vibe/ui — Shadcn primitives (web only)
    └── config/     ← @vibe/config — tsconfig presets
```

**Principle:** Start blank. `@vibe/config` shared. `@vibe/ui` web-only (DOM + Tailwind). Optional stacks (3D, motion) added per prompt. Frontend only — see **No server runtime**.

---

## Anti-Generic Gate (required for website tasks)

Before claiming completion for new page, run gate. If any item fails, iterate once more before finalizing.

- **Identity check:** Could page confused with generic template from another brief? If yes, fail.
- **Copy check:** Headline, subhead, section copy must be topic-specific (no placeholder or generic SaaS phrasing).
- **Layout check:** Section order and composition must be intentionally chosen for brief, not default boilerplate.
- **Motion check:** If the user explicitly requested animation or the core interaction requires it, motion is visible and purposeful. Otherwise no animation library or ornamental entrance motion is added.
- **Theme check:** Palette, typography, light/dark choice must reflect brief via semantic tokens and CSS variables (not default purple-on-dark unless requested).
- **Image check:** If intended design includes imagery, every hero/card/section image must render, feel relevant to brief, no broken/missing states.

If result still feels template-like, stop and rework the section map and palette direction before more coding.

### Anti-clichés (avoid these in greenfield and brand-vague builds)

The user's brief or an attached DESIGN.md may explicitly forbid some of these — even when neither does, treat the list as a default. If a DESIGN SYSTEM block appears in your system prompt, it wins; these defaults only fill the vacuum.

- **Fonts to avoid for hero / marketing / brand-led pages:** Inter, Roboto, Open Sans, Lato, Arial, generic system sans. Use the family the user named in their brief or the one specified in DESIGN.md if attached. If neither names a family, pick from: Playfair Display / Crimson Pro / Fraunces (editorial), Clash Display / Satoshi / Cabinet Grotesk (startup), JetBrains Mono / Fira Code / Space Grotesk (technical), IBM Plex (corporate), Bricolage Grotesque / Syne (distinctive). Data-dense utility apps (trading, dashboards) are the one place Inter / IBM Plex Sans is correct.
- **No purple-or-blue gradient on white** as the default hero treatment.
- **No 3-column rounded-corner soft-shadow card grid** as the primary feature section. Try asymmetric grids, overlapping cards, off-axis layouts, single hero feature + supporting list — anything but the default.
- **No flat solid background.** Layer atmosphere: gradient meshes, noise textures, layered transparencies, dramatic shadows, grain overlays, decorative borders.
- **No scattered micro-interactions.** When animation is justified, spend the motion budget on one orchestrated moment rather than many small hover wiggles.
- **No timid evenly-distributed palette.** A dominant color + a sharp accent beats four pastel tints in equal proportion.
- **Use weight extremes and large size jumps.** Headline 800/900 against body 300/400, hero size 3x+ the body — not 1.5x. Tepid contrast is the AI-slop signature.
- **No emojis as icons.** `lucide-react` only for UI icons. Emojis are acceptable only inside genuine user-typed content (chat bubbles, post bodies).

**Extra rules that kick in when the prompt matches:**

| When the brief involves | Do this |
|--------|------|
| A product category, audience, or visual direction beyond the neutral default | Derive the palette via **semantic CSS variables** — don't default to generic purple-on-dark unless the brief fits. |
| 3D, WebGL, p5, charts, or other heavy libs | Pick **minimal** deps; use `pnpm --filter @vibe/app-vite run add:three-r18` or `add:p5` when applicable; add to `package.json` before importing. |
| Remote photos or local/public assets **without** API keys | Verified existing `/public/` images and **Unsplash** direct image URLs, with license awareness. See **Lists, catalog, and imagery** below. |

---

## Frontend-first (default)

**No server runtime.** Mercury previews the app with only the Vite dev server and publishes the static `vite build` output, so no server code ever runs: `/api/*` routes, databases, and server-held secrets cannot work in preview or when published. Build every feature client-side. If the user asks for a backend, tell them it is not supported yet and build the client-side version.

- **No API keys for demos:** Use hardcoded arrays, `import`ed JSON under `client/`, or placeholder images in `public/`. User shouldn't need `.env` or separate API server to see polished page.
- **Theme and layout** priority, in order: derive the palette from the brief, map the sections, build the components, keep design-token usage consistent — then verify.

---

## Mercury visual editing compatibility

Generated React must be easy for Mercury to inspect, select, and edit visually. If a user can click a visible surface in the preview, its JSX should be understandable without Mercury guessing through hidden state, deeply shared components, or computed class strings.

- **Keep visible surfaces editable:** Put the main `className` and user-visible text on the element the user would click or visually identify. Avoid unnecessary wrapper-only styling when the actual surface is a child element.
- **Use direct text for editable copy:** Button labels, headings, nav labels, card titles, and CTA copy should usually be direct JSX text, for example `<button>Shop now</button>`. Do not bury editable copy in unnecessary spans, arrays, expression fragments, or a shared child component unless the structure is genuinely needed.
- **Keep class strings legible:** Prefer literal `className` strings or simple `cn()` calls with static Tailwind utilities. Avoid constructing core visual classes through string concatenation, object maps, array joins, helper functions, or complex template expressions on elements the user is likely to edit.
- **Separate base styles from app states:** Put default appearance in base utilities (`bg-*`, `text-*`, `border-*`). Put hover, pressed, and selected appearances in explicit variants such as `hover:*`, `active:*`, `aria-selected:*`, `aria-pressed:*`, `aria-current:*`, `aria-checked:*`, `data-[state=active]:*`, and `data-[selected]:*`. This lets Mercury change the base Fill/Text while preserving app hover and selected colors.
- **Do not encode selected state by swapping plain base classes:** Avoid `isSelected ? "bg-blue-600 text-white" : "bg-white text-black"` for editable tabs, filters, segmented controls, and toggle buttons. Mercury can only see the current plain classes, so it may edit the selected branch as if it were the base style.
- **Prefer semantic selected attributes:** Model app-selected state on the styled element with `aria-selected`, `aria-pressed`, `aria-current`, `aria-checked`, `data-selected`, `data-active`, or `data-state="active|selected|checked|on"`, then pair it with Tailwind state variants.
- **Preferred selected-state pattern:**

```tsx
<button
  aria-selected={selectedTab === "overview"}
  className="rounded-md bg-white px-4 py-2 text-slate-700 hover:bg-slate-100 aria-selected:bg-blue-600 aria-selected:text-white"
>
  Overview
</button>
```

- **Alternative Radix-style state pattern:**

```tsx
<button
  data-state={selected ? "active" : "inactive"}
  className="rounded-md bg-white px-4 py-2 text-slate-700 hover:bg-slate-100 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
>
  All
</button>
```

- **Avoid inline editable colors:** Prefer Tailwind utilities, including arbitrary values like `bg-[#123456]` and `text-[#123456]`, over `style={{ color: ... }}` or `style={{ backgroundColor: ... }}`. Inline color styles beat Tailwind classes after reload and make visual edits harder to preserve. Use inline styles only for genuinely dynamic runtime values.
- **Keep short static lists explicit:** For small fixed UI like three feature cards, four tabs, or a hero CTA pair, prefer explicit JSX siblings over a `.map()` or a shared component. Use `.map()` only when the content is truly data-driven.
- **Inline editable repeated surfaces:** If a catalog/list must use `.map()`, put the editable card/button JSX directly inside `.map((item, index) => ...)` and include the index parameter. Do not hide clickable or selectable repeated surfaces inside reused components such as `BookCard`, `FeatureCard`, `ProductCard`, `CTAButton`, helper render functions, config-driven component maps, or wrapper components for test pages. Repeated component internals share one source `data-oid`, so Mercury may show an optimistic per-instance edit that cannot be saved back to source.
- **Prefer duplication over abstraction for editable demos:** For small catalogs, pricing tables, feature grids, card lists, segmented filters, and CTA groups, duplicate the JSX at the visible surface or keep it directly in the loop body. Do not extract the editable card/button/tab into a child component just to reduce repetition.
- **Avoid one literal shared by many instances:** Do not hardcode user-visible text inside a single reused component if different instances may need independent edits. Inline the literal at each call site or make the data source the obvious editable place.

---

## Autonomous UI: theme, data, and libraries

### Theme (vibe without locking one hue)

- **Semantic roles** stay stable (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, …). **Hue/saturation** change per project in the theme variables of `apps/vite/client/global.css` (`:root`, plus `.dark` when present). If this run's system prompt marks `global.css` compiler-owned (a DESIGN SYSTEM block or a read-only notice), follow that instead and do not edit it. Theme tokens are CSS custom properties holding **real CSS colors** (e.g. `--primary: hsl(262 83% 58%)` or any valid color), mapped to utilities via the `@theme inline` block. Never use raw `bg-white`/`bg-black`/hex utility classes — breaks theme switching.
- **Theme switch prompts** (e.g. "make it dark"): `next-themes` owns the `<html>` theme class, so never set it in `index.html`. Make sure the requested palette exists in `global.css` (keep both palettes for switchable themes), then follow the system prompt's THEME SWITCHING section; the compiler-owned exception above still applies.
- Settle the palette early when the user describes a brand or a clone "feel."
- Choose **light**, **dark**, or **dual-theme** from brief. Dark theme choice, **not** default.
- If the brief supports both modes, make sure both palettes are intentionally designed, then enable a **theme toggle** using the existing `next-themes` setup. The starter defaults to the light theme and does not follow the OS theme automatically.
- For new pages, explore **at least 2 palette directions** before choosing one. Don't settle on near-black + single accent fallback unless brief supports it.
- Spacing, radius, and token *usage* rules still apply whatever the hue; nothing forces purple — set `--primary` etc. from the brief.

### Lists, "catalog", and imagery (frontend-only)

- Use **local data**: TypeScript constants, `import data from './data.json'`, or few rows in same file.
- Use only verified image sources: existing `/public/` files confirmed with `list_dir`, exact remote URLs returned by `search_photos` in the current task, URLs explicitly provided by the user, or URLs already present in working source.
- Never invent, remember, shorten, concatenate, or guess remote image URLs, including plausible-looking `images.unsplash.com/photo-*` URLs. Store returned URLs as exact string constants and use CSS for sizing/cropping.
- If an image source fails or is unavailable, do not mention service limits to the user. Use a verified asset, another URL returned by the image tool, or a deliberate non-image visual treatment.
- Every image area must have stable dimensions and a non-image fallback background/pattern/color. For important `<img>` tags, hide broken images with `onError={(event) => { event.currentTarget.hidden = true; }}` so the fallback remains visible.
- For local public assets, use `assetPath("hero.jpg")` or `` `${import.meta.env.BASE_URL}hero.jpg` ``. Never use root-absolute local paths like `/hero.jpg`, and avoid dynamic public refs like `assetPath(photo.file)` unless every possible file exists.
- This app may be hosted under a non-root base path. For internal page navigation use React Router `<Link to="/pricing">` or `useNavigate()` — the app's `basename` maps app routes to the hosted mount. Never use raw root-relative browser URLs for app pages: `<a href="/">`, `<a href="/pricing">`, `window.location.href = "/…"`, or `location.assign("/…")` all treat `/` as the domain root and escape the preview. Raw `<a href>` is fine for external URLs, `#` anchors, and `mailto:`/`tel:` links. `<Route path="/…">`, `<Link to>`, and `navigate()` are unaffected.
- If images are part of the design and preview inspection is available, confirm they visibly render before calling the page complete.

### Libraries (Three.js, p5, …)

- Default install stays lean. Add **three** / **@react-three/fiber** / **@react-three/drei** or **p5** only when prompt requires 3D or generative canvas — keep deps minimal and prefer the existing scripts in `apps/vite/package.json` (`add:three-r18`, `add:p5`).
- Use **web search / docs** to pick maintained packages; avoid stacking redundant renderers.

### What not to do

- Don't require API keys or second server for **default** marketing or demo UIs — use fixtures, `public/`, chosen Unsplash URLs, or deliberate non-image treatments.
- Don't hotlink images from sites that forbid it; prefer verified Unsplash URLs or own `public/` files.
- Don't leave image-dependent sections with empty `src`, uncertain URLs, or no fallback path.
- Don't ship secret **API keys** in client bundles.
- Don't add heavy graphics libraries "just in case."

---

## Package manager

```bash
pnpm install
pnpm --filter @vibe/app-vite dev      # web app
```

**pnpm rule:** Any package you `import` must be **direct** dependency of app's `package.json`. Add deps **before** importing.

---

## What is in the default install

| Need | In default `package.json`? | Import from |
|---|---|---|
| UI | Yes | `@vibe/ui` |
| Icons | Yes | `lucide-react` |
| Motion | Yes | `framer-motion` |
| Data fetching | Yes | `@tanstack/react-query` |
| Toasts | Yes | `sonner` |
| Theme | Yes | `next-themes` |
| 3D / WebGL | **No** — add when prompt asks | `three`, `@react-three/fiber`, `@react-three/drei` |
| Generative canvas | **No** — add when prompt asks | `p5` |

---

## `@vibe/ui` — quick reference

```tsx
import {
  Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent,
  Input, Label, Tabs, TabsList, TabsTrigger, TabsContent,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  cn,
} from "@vibe/ui"
```

---

## Motion & animation (Framer Motion)

**Opt-in only:** Do not use Framer Motion for a static page by default. Prefer CSS transitions/animations for simple hover, focus, and one-shot effects. Use Framer Motion only when the user explicitly requests animation that needs orchestration, gestures, layout transitions, or route transitions.

**Editable text:** Do not put stable headings or body copy directly in `motion.h1`-`motion.h6`, `motion.p`, or `motion.span`. Animate a non-text wrapper and keep the semantic text element, its literal copy, and its typography classes on a plain child.

**Visibility:** Motion must be **noticeable within few seconds** of load or scroll. Overly slow drift reads as "broken."

**TypeScript — `ease` on variants:** String literals like `ease: "easeOut"` can fail strict typing. Prefer:

- `ease: [0.16, 1, 0.3, 1] as const` (cubic-bezier), or
- Omit `ease`, use `duration` only.

**Scroll:** Use `whileInView` with `viewport={{ once: true }}` for section reveals.

**Co-located variants pattern:**

```tsx
import { motion } from "framer-motion"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function Section() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      <section>
        <h2 className="text-4xl font-semibold">Editable heading</h2>
        <p className="mt-4 text-base leading-relaxed">Editable body copy.</p>
      </section>
    </motion.div>
  )
}
```

---

## WebGL / Three.js patterns (when Three.js is installed)

Rules prevent silent black screens, grey textures, washed-out color — bugs hard to diagnose.

### Canvas layout

Put canvas in `absolute inset-0` inside `relative` container. UI overlays in sibling `z-10` div. Vignette between canvas and text keeps copy readable regardless of scene.

```tsx
<section className="relative h-screen overflow-hidden">
  <div className="absolute inset-0">
    <Canvas camera={{ position: [0, 0, 5], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <Scene />
    </Canvas>
  </div>
  {/* optional: darken edges so text stays readable */}
  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#000_80%)]" />
  <div className="relative z-10 flex h-full items-center justify-center">
    {/* UI content here */}
  </div>
</section>
```

### Texture loading — always imperative, never `useTexture` + `Suspense`

`useTexture` (drei) suspends by throwing Promise. When nested inside `<group>` inside Canvas and URL fails, error escapes Suspense boundary, React unmounts entire canvas tree, page goes **black** with no terminal output.

**Safe pattern — `THREE.TextureLoader` + material refs:**

```tsx
import { useEffect, useRef } from "react"
import * as THREE from "three"

function MyMesh() {
  const meshRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    const loader = new THREE.TextureLoader()

    loader.load("https://cdn.jsdelivr.net/npm/<pkg>/path/texture.jpg", (tex) => {
      if (!meshRef.current) return
      const mat = meshRef.current.material as THREE.MeshStandardMaterial
      mat.map = tex
      mat.color.set("#ffffff")  // reset tint so texture renders with natural colours
      mat.needsUpdate = true
    })
  }, [])

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#888888" />  {/* fallback shown until texture loads */}
    </mesh>
  )
}
```

`loader.load()` plain callback — never throws, never touches React. Mesh always visible. If URL fails, fallback color holds.

**CDN for npm-hosted assets:** `https://cdn.jsdelivr.net/npm/<package>/<path>` — jsDelivr serves all npm files with `Access-Control-Allow-Origin: *`, no redirects.

### Mouse-driven parallax

`useFrame` exposes `state.mouse` (normalised −1 → 1). Use `lerp` for smooth lag:

```tsx
useFrame(({ mouse }) => {
  if (!ref.current) return
  ref.current.rotation.y += 0.003  // constant auto-rotate
  ref.current.rotation.x = THREE.MathUtils.lerp(ref.current.rotation.x, -mouse.y * 0.5, 0.05)
  ref.current.rotation.z = THREE.MathUtils.lerp(ref.current.rotation.z,  mouse.x * 0.08, 0.05)
})
```

Wrap multiple meshes in `<group ref={ref}>` so they all move together.

### Lighting recipe for textured meshes

**`ambientLight` intensity > 0.3 washes all textures grey.** Start low, layer:

```tsx
<ambientLight intensity={0.15} />                                          {/* base, keep low */}
<directionalLight position={[5, 3, 5]} intensity={3} color="#ffffff" />   {/* key light */}
<pointLight position={[-5, -2, -5]} intensity={0.5} color="#aaccff" />    {/* fill/rim */}
```

Adjust positions and colors to match prompt. Single strong directional light creates natural shadow contrast on any textured mesh.

### Rim glow on any object (no shader needed)

Wrap object in `BackSide` sphere scaled slightly larger:

```tsx
<mesh scale={1.08}>
  <sphereGeometry args={[radius, 32, 32]} />
  <meshStandardMaterial color="#4499ff" transparent opacity={0.1} side={THREE.BackSide} />
</mesh>
```

Stack two at different scales for softer falloff. Works on any convex shape.

### Particle background

```tsx
import { Stars } from "@react-three/drei"
<Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade />
```

---

## Canvas 2D (when `getContext("2d")` is used — no extra deps)

Rules apply to **any** generative 2D canvas (grass, particles, charts). **Not** tied to specific visual prompt.

### Layout — avoid zero-height or black canvas

- Give canvas **real size**: `fixed inset-0` + `h-screen` / `min-h-screen` on parent, or set explicit `width`/`height` in CSS. If parent only contains absolutely positioned children, layout height collapses to **0** and nothing draws.
- `#root` (or app shell) should have **`min-height: 100dvh`** (or `100svh`) so full-viewport pages always get height.

### Pointer / touch coordinates — one coordinate space

- Draw using logical size from **`canvas.clientWidth` / `clientHeight`** (after DPR transform if used).
- Convert pointer position with **`canvas.getBoundingClientRect()`** — **not** different wrapper `div`, unless wrapper **pixel-identical** to canvas. Mismatched rects make mouse effects "wrong" with no console error.

### DPR and resizing

- Cap **`devicePixelRatio`** for heavy scenes (e.g. `Math.min(devicePixelRatio, 1)` or `2`) so mobile doesn't allocate huge buffers.
- On resize, **`canvas.width = …` / `height = …` resets context**. Re-apply **`setTransform(dpr, 0, 0, dpr, 0, 0)`** (or re-fetch context) after changing dimensions.
- Use **`ResizeObserver`** on container (or window `resize`) so backing store matches CSS size.

### Performance — blur and filters

- **`ctx.filter` (e.g. `blur`)** on **main** framebuffer each frame costly; **`filter` per path** (thousands of strokes) performance trap.
- Prefer: draw scene to **offscreen canvas**, then **`drawImage`** offscreen onto main canvas **once or twice** with `filter` / `globalAlpha` for glow or DOF — same look, far fewer filter applications.
- **Cap work per frame**: max particle count, bucket by layer instead of `filter()`ing full array every frame, avoid `getContext("2d")` inside animation loop (cache context ref).

### Lifecycle

- **`requestAnimationFrame`**: skip work when **`document.visibilityState === "hidden"`** to save CPU when tab backgrounded.

### Verification (canvas pages)

- Hard-refresh, confirm canvas region **non-black** and **pointer-driven effects** track cursor.
- Chrome Performance / Task Manager: watch for **sustained jank** when adding blur + high entity counts.

---

## Page-level structure contract

Every page added under `client/pages/` must follow this structure.

```tsx
// client/pages/MyPage.tsx

// 1. Imports: React, @vibe/ui, lucide, local components — in that order
import { Button, Badge } from "@vibe/ui"

// 2. Sub-components above the default export
function HeroSection() { /* ... */ }
function FeatureGrid() { /* ... */ }

// 3. Single default export — the page shell
export default function MyPage() {
  return (
    <main className="min-h-screen bg-background">
      <HeroSection />
      <FeatureGrid />
    </main>
  )
}
```

**Rules:**
- One default export per file — page itself.
- Add Motion imports and variants only when justified by the prompt; keep variants and constants at **module scope**, never inside render.
- Sub-components in same file (small) or `client/components/` (reused across pages).
- Every page gets `<main className="min-h-screen bg-background">`.
- Keep page height measurement-friendly for Mercury previews: prefer document-flow layouts and Tailwind viewport utilities (`min-h-screen`, `h-screen`, `h-[calc(100vh-...)]`) over inline JS viewport sizing such as `style={{ height: window.innerHeight }}`. Avoid wrapping an entire page in a nested `overflow-auto`/`overflow-scroll` container unless the design specifically requires an internal scroller; let the document body own the full page height so expanded previews can show the full page without iframe scrollbars.
- Route registration in `App.tsx` **required**.

**Registering a route:**

```tsx
// client/App.tsx — add above the "*" catch-all
import MyPage from "./pages/MyPage"
<Route path="/my-page" element={<MyPage />} />
```

### Home route and page plan

When Mercury supplies a `== PAGE PLAN ==` block in your system prompt, follow it exactly:

- Build every page listed in the plan.
- Register every route in `apps/vite/client/App.tsx` above the catch-all `"*"` route.
- The plan always includes a `/` page. Build it and make sure it is the entry point.
- When the plan says `Top navigation required`, build `apps/vite/client/components/TopNav.tsx` (see template below) and render it on every page so the user can reach all routes from `/`.

When no `== PAGE PLAN ==` block is present:

- **Style, copy, or layout edits** to an existing page: edit the target page file in place.
- **New page or distinct route requested** (e.g. "login page", "about page", "dashboard", "contact"): create `apps/vite/client/pages/NewPage.tsx` + register the route in `apps/vite/client/App.tsx` above the `"*"` catch-all. NEVER create a `.html` file — this is a React SPA; only `index.html` is served by Vite. NEVER stuff new-page content into `pages/Index.tsx` to avoid creating a new file.
- **Page files are composition roots, not monoliths**: a `pages/*.tsx` file should hold imports + a layout shell (header, section composition, footer). When the page has 3+ distinct visible sections (hero, features, gallery, marquee, testimonials, contact, footer, custom cursor, etc.), each section goes in its own file under `apps/vite/client/components/` (e.g. `HeroSection.tsx`, `FeaturesSection.tsx`, `Marquee.tsx`). The page file imports them and lays them out. NEVER exceed ~500 lines in a page file — if your design needs more, split BEFORE writing, not after. Use `write_files` (batch) to create the page + all section components in ONE call.

#### Recommended top-nav pattern

```tsx
// apps/vite/client/components/TopNav.tsx
import { Link, useLocation } from "react-router-dom"
import { Button, cn } from "@vibe/ui"

const links = [
  { to: "/",          label: "Home" },
  { to: "/pricing",   label: "Pricing" },
  { to: "/contact",   label: "Contact" },
]

export function TopNav() {
  const { pathname } = useLocation()
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link to="/" className="text-base font-semibold">Brand</Link>
        <div className="flex items-center gap-2">
          {links.map((l) => (
            <Button asChild variant={pathname === l.to ? "default" : "ghost"} key={l.to}>
              <Link to={l.to}>{l.label}</Link>
            </Button>
          ))}
        </div>
      </div>
    </nav>
  )
}
```

Render `<TopNav />` from each page (or from a layout component composed at the route level). Do not put nav inside a single page only — the user must see it on every route.

---

## Pages

- **Page:** `client/pages/MyPage.tsx` + route in `App.tsx`

---

## Styling

Tailwind + semantic tokens. Use `cn()` from `@vibe/ui`.

---

## Verification — run after every meaningful change

```bash
# 1. Type safety
pnpm --filter @vibe/app-vite typecheck

# 2. Build (catches bundler errors typecheck misses)
pnpm --filter @vibe/app-vite build:client

# 3. Dev server smoke check
pnpm --filter @vibe/app-vite dev
```

After dev server starts:
- Open `http://localhost:5173` — page must load without white screen
- Browser console must show **zero errors** (warnings acceptable)
- If design includes images: confirm every intended hero/card/section image actually renders; broken or missing images fail verification
- If animations added: hard-refresh and confirm motion visible within 2 seconds

**When to run:** after `pnpm add …`, after writing new component, after wiring new route.

---

## React 19 migration path

Template ships **React 18** (`react@^18.3`). When upgrading:

**Step 1 — Upgrade React:**
```bash
pnpm --filter @vibe/app-vite add react@^19 react-dom@^19
pnpm --filter @vibe/app-vite add -D @types/react@^19 @types/react-dom@^19
```

**Step 2 — If Three.js / R3F installed**, upgrade to fiber v9 (requires React 19):
```bash
pnpm --filter @vibe/app-vite add three @react-three/fiber@^9 @react-three/drei
pnpm --filter @vibe/app-vite add -D @types/three
```

**Step 3 — Check Framer Motion** (v12 supports React 19):
```bash
pnpm --filter @vibe/app-vite add framer-motion@^12
```

**Step 4 — Verify:**
```bash
pnpm --filter @vibe/app-vite typecheck && pnpm --filter @vibe/app-vite build:client
```
Fix any type errors — React 19 tightened some prop types (`children` no longer implicit).

---

## DO / DON'T

**DO** run full **verification steps** (typecheck → build → dev) after every change.  
**DO** follow **page-level structure contract** for every new page.  
**DO** add packages to `apps/vite/package.json` before importing.  
**DO** load textures imperatively with `THREE.TextureLoader` + material refs — never `useTexture` + `Suspense` nested inside Canvas.  
**DO** keep `ambientLight intensity` ≤ 0.2 when using textured meshes.  
**DO** use jsDelivr (`cdn.jsdelivr.net/npm/…`) for any CDN texture URLs.  
**DO** give Canvas container `absolute inset-0` (or explicit height) — zero-height parent = blank WebGL surface.  
**DO** align pointer coordinates with **same** element used for drawing (`canvas.getBoundingClientRect()` vs `clientWidth`/`Height`).  
**DO** composite expensive **blur/glow** via **offscreen** canvas + `drawImage`, not `filter` on thousands of primitives per frame.  
**DO** use **fixtures**, verified **`public/`** assets, or **Unsplash** URLs (per license) for imagery — no keys required for frontend demos.
**DO** replace any uncertain image with stable fallback or deliberate non-image visual treatment before calling page complete.  
**DO** browser-check all intended images after starting dev server; passing build doesn't prove they render.  
**DO** use **official embed URLs** for video when embedding third-party players — not scraped player pages.  
**DO** derive the palette from the brief when user wants specific product look; set **CSS variables** for `--primary` etc., not hardcoded palette classes across app.  
**DO** choose light vs dark intentionally from brief; defaulting to black backgrounds without reason = failure.

**DON'T** import `three` / `@react-three/*` / `p5` unless prompt explicitly asks for 3D or generative canvas.  
**DON'T** put secret API keys in `VITE_*` or import from client code.  
**DON'T** write `"use client"` (Vite-only app).  
**DON'T** define motion variants inside component render function.  
**DON'T** leave page file without matching route in `App.tsx`.  
**DON'T** use `useTexture` + `Suspense` inside Canvas group — silently kills entire canvas on texture error.
