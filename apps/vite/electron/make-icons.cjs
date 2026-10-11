/**
 * Art Life Creative Studio — icon generator.
 *
 * Renders the SVG sources in apps/vite/branding/ into every icon the platforms need:
 *   electron/build/icon.ico        Windows .exe + installer (16–256 px)
 *   electron/build/icon-mac.png    macOS (electron-builder turns it into .icns)
 *   electron/build/icon.png        Linux + the window/taskbar icon at runtime
 *   branding/android/res/…         Android launcher icons (adaptive + legacy + round + themed)
 *   branding/android/playstore-icon.png   Google Play 512 px
 *   public/icons/…                 Web / PWA install icons (Android "Add to Home screen", iOS)
 *
 * Run:  npm run icons        (from apps/vite/electron)
 */
const fs = require("node:fs")
const path = require("node:path")
const { Resvg } = require("@resvg/resvg-js")
const pngToIco = require("png-to-ico")

const ROOT = path.resolve(__dirname, "..")
const BRAND = path.join(ROOT, "branding")
const BUILD = path.join(__dirname, "build")
const ANDROID = path.join(BRAND, "android")
const PUBLIC_ICONS = path.join(ROOT, "public", "icons")
const ORANGE = "#FF7A1A"

const read = (f) => fs.readFileSync(path.join(BRAND, f), "utf8")
const mkdir = (d) => fs.mkdirSync(d, { recursive: true })
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" }).render().asPng()
const write = (file, buf) => {
  mkdir(path.dirname(file))
  fs.writeFileSync(file, buf)
  console.log("  ✓", path.relative(ROOT, file))
}

const appSvg = read("icon-app.svg")
const macSvg = read("icon-macos.svg")
const fgSvg = read("icon-android-foreground.svg")
const monoSvg = read("icon-android-monochrome.svg")

// Foreground mark on a full-bleed / round orange background (maskable, legacy Android, iOS).
const fgInner = fgSvg.slice(fgSvg.indexOf("<g"), fgSvg.lastIndexOf("</svg>"))
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 432"><rect width="432" height="432" fill="${ORANGE}"/>${fgInner}</svg>`
const legacySquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 432"><rect x="36" y="36" width="360" height="360" rx="72" fill="${ORANGE}"/>${fgInner}</svg>`
const legacyRound = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 432"><circle cx="216" cy="216" r="180" fill="${ORANGE}"/>${fgInner}</svg>`

async function main() {
  console.log("Art Life Creative Studio — generating icons")

  /* ---------- desktop (electron-builder) ---------- */
  write(path.join(BUILD, "icon.png"), render(appSvg, 1024))
  write(path.join(BUILD, "icon-mac.png"), render(macSvg, 1024))
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const tmp = path.join(BUILD, ".ico-src")
  mkdir(tmp)
  const icoFiles = icoSizes.map((s) => {
    const f = path.join(tmp, `${s}.png`)
    fs.writeFileSync(f, render(appSvg, s))
    return f
  })
  write(path.join(BUILD, "icon.ico"), await pngToIco(icoFiles))
  fs.rmSync(tmp, { recursive: true, force: true })

  /* ---------- Android ---------- */
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(ANDROID, "res", `mipmap-${d}`)
    write(path.join(dir, "ic_launcher.png"), render(legacySquare, Math.round(48 * k)))
    write(path.join(dir, "ic_launcher_round.png"), render(legacyRound, Math.round(48 * k)))
    write(path.join(dir, "ic_launcher_foreground.png"), render(fgSvg, Math.round(108 * k)))
    write(path.join(dir, "ic_launcher_monochrome.png"), render(monoSvg, Math.round(108 * k)))
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`
  write(path.join(ANDROID, "res", "mipmap-anydpi-v26", "ic_launcher.xml"), Buffer.from(adaptive))
  write(path.join(ANDROID, "res", "mipmap-anydpi-v26", "ic_launcher_round.xml"), Buffer.from(adaptive))
  write(
    path.join(ANDROID, "res", "values", "ic_launcher_background.xml"),
    Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ORANGE}</color>\n</resources>\n`),
  )
  write(path.join(ANDROID, "playstore-icon.png"), render(fullBleed, 512))

  /* ---------- web / PWA ---------- */
  write(path.join(PUBLIC_ICONS, "icon-192.png"), render(appSvg, 192))
  write(path.join(PUBLIC_ICONS, "icon-512.png"), render(appSvg, 512))
  write(path.join(PUBLIC_ICONS, "maskable-512.png"), render(fullBleed, 512))
  write(path.join(PUBLIC_ICONS, "apple-touch-icon.png"), render(fullBleed, 180))
  const manifest = {
    name: "Art Life Creative Studio",
    short_name: "Art Life",
    description: "Pressure-sensitive pencil and vector drawing studio",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: "#222226",
    theme_color: "#222226",
    icons: [
      { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
  write(path.join(ROOT, "public", "manifest.webmanifest"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"))

  console.log("Done.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
