/**
 * Art Life Creative Studio — builds the installable APK.
 * Output: apps/vite/android-app/release/ArtLife-Creative-Studio-<version>.apk
 */
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { spawnSync } = require("node:child_process")

const HERE = path.resolve(__dirname, "..")
const ANDROID = path.join(HERE, "android")
const pkg = require(path.join(HERE, "package.json"))
const win = process.platform === "win32"

if (!fs.existsSync(path.join(ANDROID, "app"))) {
  console.error("\nAndroid project missing. Run:  npm run apk\n")
  process.exit(1)
}

/* Use the Java that ships inside Android Studio when JAVA_HOME is not set. */
const env = { ...process.env }
const javaOk = (p) => p && fs.existsSync(path.join(p, "bin", win ? "java.exe" : "java"))
if (!javaOk(env.JAVA_HOME)) {
  const home = os.homedir()
  const jbr = [
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr"),
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    path.join(home, "Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
    "/opt/android-studio/jbr",
    path.join(home, "android-studio", "jbr"),
  ].find(javaOk)
  if (jbr) {
    env.JAVA_HOME = jbr
    console.log(`Using Java from Android Studio: ${jbr}`)
  } else {
    console.warn("! Java not found. Install Android Studio (it includes Java), then run this again.")
  }
}

console.log("\n\u25B6 Building the APK (first build downloads Gradle — can take 5–10 minutes)\n")
const gradlew = win ? "gradlew.bat" : "./gradlew"
if (!win) fs.chmodSync(path.join(ANDROID, "gradlew"), 0o755)
const res = spawnSync(gradlew, ["assembleDebug"], { cwd: ANDROID, stdio: "inherit", env, shell: win })
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
