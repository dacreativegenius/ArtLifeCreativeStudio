/**
 * Art Life Creative Studio — builds the installable APK.
 * Output: apps/vite/android-app/release/ArtLife-Creative-Studio-<version>.apk
 *
 * Capacitor 7 compiles with Java 21. This script finds a Java 21+ install on its own
 * (Android Studio's bundled Java first), pins Gradle to it, and runs Gradle without a
 * background daemon so no files stay locked after the build.
 */
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { spawnSync } = require("node:child_process")

const HERE = path.resolve(__dirname, "..")
const ANDROID = path.join(HERE, "android")
const pkg = require(path.join(HERE, "package.json"))
const win = process.platform === "win32"
const REQUIRED_JAVA = 21

if (!fs.existsSync(path.join(ANDROID, "app"))) {
  console.error("\nAndroid project missing. Run:  npm run apk\n")
  process.exit(1)
}

/* ---------------- find Java 21+ ---------------- */

const hasJava = (p) => p && fs.existsSync(path.join(p, "bin", win ? "java.exe" : "java"))

/** Reads the major version from the JDK's `release` file (JAVA_VERSION="21.0.5"). */
function javaMajor(home) {
  try {
    const release = fs.readFileSync(path.join(home, "release"), "utf8")
    const m = release.match(/JAVA_VERSION="(\d+)(?:\.(\d+))?/)
    if (!m) return 0
    const major = Number(m[1])
    return major === 1 ? Number(m[2] || 0) : major
  } catch {
    const res = spawnSync(path.join(home, "bin", win ? "java.exe" : "java"), ["-version"], { encoding: "utf8" })
    const m = String(res.stderr || res.stdout || "").match(/version "(\d+)/)
    return m ? Number(m[1]) : 0
  }
}

/** Lists JDK folders inside a parent folder, e.g. C:\Program Files\Java\jdk-21.0.5 */
function jdksIn(parent) {
  try {
    return fs
      .readdirSync(parent)
      .map((d) => path.join(parent, d))
      .flatMap((d) => [d, path.join(d, "Contents", "Home")])
  } catch {
    return []
  }
}

const home = os.homedir()
const pf = process.env.ProgramFiles || "C:\\Program Files"
const candidates = [
  process.env.JAVA_HOME,
  path.join(pf, "Android", "Android Studio", "jbr"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr"),
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  path.join(home, "Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
  "/opt/android-studio/jbr",
  path.join(home, "android-studio", "jbr"),
  ...jdksIn(path.join(pf, "Java")),
  ...jdksIn(path.join(pf, "Eclipse Adoptium")),
  ...jdksIn(path.join(pf, "Microsoft")),
  ...jdksIn(path.join(pf, "Zulu")),
  ...jdksIn("/Library/Java/JavaVirtualMachines"),
  ...jdksIn("/usr/lib/jvm"),
].filter(hasJava)

const found = candidates.map((p) => ({ p, v: javaMajor(p) }))
const java = found.filter((j) => j.v >= REQUIRED_JAVA).sort((a, b) => a.v - b.v)[0]

if (!java) {
  console.error(`\n✗ Java ${REQUIRED_JAVA} was not found — the Android build needs it.`)
  if (found.length) {
    console.error("  Java versions found on this computer:")
    for (const j of found) console.error(`    Java ${j.v || "?"}  ${j.p}`)
  }
  console.error(
    `\n  Fix: install Java ${REQUIRED_JAVA} (free) from\n` +
      "    https://learn.microsoft.com/java/openjdk/download   → pick \"OpenJDK 21\" .msi for Windows x64\n" +
      "  or update Android Studio (it ships Java 21 built in). Then run  npm run apk  again.\n",
  )
  process.exit(1)
}

const env = { ...process.env, JAVA_HOME: java.p }
env.PATH = `${path.join(java.p, "bin")}${path.delimiter}${process.env.PATH || process.env.Path || ""}`
if (win) env.Path = env.PATH
console.log(`\n✓ Using Java ${java.v}: ${java.p}`)

/* ---------------- pin Gradle to that Java ---------------- */
// Removes any old/broken org.gradle.java.home line and writes the correct one (forward slashes).
const propsPath = path.join(ANDROID, "gradle.properties")
let props = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf8") : ""
props = props
  .split(/\r?\n/)
  .filter((l) => !/^\s*org\.gradle\.java\.home\s*=/.test(l))
  .join("\n")
  .replace(/\n+$/, "")
props += `\norg.gradle.java.home=${java.p.replace(/\\/g, "/")}\n`
fs.writeFileSync(propsPath, props)

/* ---------------- build ---------------- */
const gradlew = win ? "gradlew.bat" : "./gradlew"
if (!win) fs.chmodSync(path.join(ANDROID, "gradlew"), 0o755)
const gradle = (args) => spawnSync(gradlew, args, { cwd: ANDROID, stdio: "inherit", env, shell: win })

// Stop any Gradle left running from an earlier attempt (this is what locks files).
gradle(["--stop"])

console.log("\n\u25B6 Building the APK (first build downloads Gradle — can take 5–10 minutes)\n")
const res = gradle(["assembleDebug", "--no-daemon"])
if (res.status !== 0) {
  console.error("\nAPK build failed — copy the red error lines above and send them over.\n")
  process.exit(res.status || 1)
}

const built = path.join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
const outDir = path.join(HERE, "release")
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, `ArtLife-Creative-Studio-${pkg.version}.apk`)
fs.copyFileSync(built, out)
console.log(`\n\u2713 APK ready:\n  ${out}\n\nCopy it to your Android phone or tablet and tap it to install.\n`)
