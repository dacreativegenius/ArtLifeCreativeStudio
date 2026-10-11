/**
 * Art Life Creative Studio — prepares the Android project.
 *   1. creates android/ with Capacitor (first run only)
 *   2. copies the latest web build (../dist) into the app
 *   3. installs the Art Life icons + splash screen
 *   4. sets file-saving permissions, version number and the Android SDK location
 */
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { execSync } = require("node:child_process")
const { Resvg } = require("@resvg/resvg-js")

const HERE = path.resolve(__dirname, "..")
const VITE = path.resolve(HERE, "..")
const BRAND = path.join(VITE, "branding")
const ANDROID = path.join(HERE, "android")
const MAIN = path.join(ANDROID, "app", "src", "main")
const RES = path.join(MAIN, "res")
const pkg = require(path.join(HERE, "package.json"))
const ORANGE = "#FF7A1A"
const GRAPHITE = "#222226"

const run = (cmd) => execSync(cmd, { cwd: HERE, stdio: "inherit" })
const mkdir = (d) => fs.mkdirSync(d, { recursive: true })
const render = (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render().asPng()
const write = (file, data) => {
  mkdir(path.dirname(file))
  fs.writeFileSync(file, data)
}
const read = (f) => fs.readFileSync(path.join(BRAND, f), "utf8")

function step(msg) {
  console.log(`\n▶ ${msg}`)
}

/* ---------- 0. web build present? ---------- */
if (!fs.existsSync(path.join(VITE, "dist", "index.html"))) {
  console.error("\nNo web build found in apps/vite/dist. Run:  npm run apk   (it builds the web app first)\n")
  process.exit(1)
}

/* ---------- 1 + 2. Capacitor ---------- */
if (!fs.existsSync(path.join(ANDROID, "app"))) {
  step("Creating the Android project (first time only)")
  run("npx cap add android")
}
step("Copying Art Life Creative Studio into the Android app")
run("npx cap sync android")

/* ---------- 3. icons + splash ---------- */
step("Installing app icons and splash screen")
const fgSvg = read("icon-android-foreground.svg")
const monoSvg = read("icon-android-monochrome.svg")
const appSvg = read("icon-app.svg")
const fgInner = fgSvg.slice(fgSvg.indexOf("<g"), fgSvg.lastIndexOf("</svg>"))
const appInner = appSvg.slice(appSvg.indexOf(">", appSvg.indexOf("<svg")) + 1, appSvg.lastIndexOf("</svg>"))
const legacySquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 432"><rect x="36" y="36" width="360" height="360" rx="72" fill="${ORANGE}"/>${fgInner}</svg>`
const legacyRound = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 432"><circle cx="216" cy="216" r="180" fill="${ORANGE}"/>${fgInner}</svg>`

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${d}`)
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
write(path.join(RES, "mipmap-anydpi-v26", "ic_launcher.xml"), adaptive)
write(path.join(RES, "mipmap-anydpi-v26", "ic_launcher_round.xml"), adaptive)
write(
  path.join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ORANGE}</color>\n</resources>\n`,
)

const splash = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.28)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${GRAPHITE}"/><svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 1024 1024">${appInner}</svg></svg>`
}
const portrait = render(splash(1080, 1920), 1080)
const landscape = render(splash(1920, 1080), 1920)
for (const dir of fs.readdirSync(RES)) {
  if (!dir.startsWith("drawable")) continue
  const file = path.join(RES, dir, "splash.png")
  if (fs.existsSync(file) || dir === "drawable") write(file, dir.includes("land") ? landscape : portrait)
}

/* ---------- 4. manifest: save to Documents on older Android ---------- */
step("Setting file permissions")
const manifestPath = path.join(MAIN, "AndroidManifest.xml")
let manifest = fs.readFileSync(manifestPath, "utf8")
if (!manifest.includes("WRITE_EXTERNAL_STORAGE")) {
  manifest = manifest.replace(
    "</manifest>",
    '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />\n' +
      '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n</manifest>',
  )
}
if (!manifest.includes("requestLegacyExternalStorage")) {
  manifest = manifest.replace("<application", '<application\n        android:requestLegacyExternalStorage="true"')
}
fs.writeFileSync(manifestPath, manifest)

/* ---------- 5. version ---------- */
const gradlePath = path.join(ANDROID, "app", "build.gradle")
let gradle = fs.readFileSync(gradlePath, "utf8")
gradle = gradle.replace(/versionCode \d+/, `versionCode ${pkg.androidVersionCode}`).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`)
fs.writeFileSync(gradlePath, gradle)

/* ---------- 6. Android SDK location ---------- */
const home = os.homedir()
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  path.join(home, "Library", "Android", "sdk"),
  path.join(home, "Android", "Sdk"),
].filter(Boolean)
const sdk = sdkCandidates.find((p) => fs.existsSync(p))
if (sdk) {
  fs.writeFileSync(path.join(ANDROID, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "/")}\n`)
  console.log(`  Android SDK: ${sdk}`)
} else {
  console.warn(
    "\n  ! Android SDK not found. Install Android Studio (https://developer.android.com/studio),\n" +
      "    open it once and finish the setup wizard, then run this command again.\n",
  )
}

console.log(`\n✓ Android project ready (v${pkg.version})`)
