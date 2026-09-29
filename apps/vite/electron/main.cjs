const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const DEV = process.argv.includes("--dev")
const DEV_URL = process.env.ART_LIFE_DEV_URL || "http://localhost:5173/"
const isMac = process.platform === "darwin"
const APP_NAME = "Art Life Creative Studio"
app.setName(APP_NAME)
if (process.platform === "win32") app.setAppUserModelId("com.artlife.creativestudio")
const WINDOW_ICON = path.join(__dirname, "build", "icon.png")

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

function rendererDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "renderer") : path.resolve(__dirname, "../dist")
}

/** Serves the built Vite app from app://local/ with SPA fallback to index.html. */
function registerAppProtocol() {
  const root = rendererDir()
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url)
    let file = path.normalize(path.join(root, decodeURIComponent(pathname)))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html")
    return net.fetch(pathToFileURL(file).toString())
  })
}

let win = null
let rendererReady = false
let pendingFile = null

/* ---------------- opening .dtm files ---------------- */

function openPath(filePath) {
  if (!filePath || !/\.dtm$/i.test(filePath)) return
  try {
    const payload = { name: path.basename(filePath), text: fs.readFileSync(filePath, "utf8") }
    if (win && rendererReady) {
      win.webContents.send("art-life:open-file", payload)
      if (win.isMinimized()) win.restore()
      win.focus()
    } else pendingFile = payload
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Could not open ${filePath}\n${err.message}`)
  }
}

const fileFromArgv = (argv) => argv.slice(1).find((a) => /\.dtm$/i.test(a) && fs.existsSync(a))

async function showOpenDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: `Open ${APP_NAME} project`,
    properties: ["openFile"],
    filters: [{ name: `${APP_NAME} project`, extensions: ["dtm"] }],
  })
  if (!canceled && filePaths[0]) openPath(filePaths[0])
}

ipcMain.on("art-life:renderer-ready", () => {
  rendererReady = true
  if (pendingFile && win) {
    win.webContents.send("art-life:open-file", pendingFile)
    pendingFile = null
  }
})

/* ---------------- saving ---------------- */

ipcMain.handle("art-life:save-file", async (_event, { bytes, filename, description, ext }) => {
  const extension = String(ext || ".png").replace(/^\./, "")
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: `Save ${description || "file"}`,
    defaultPath: path.join(app.getPath(extension === "dtm" ? "documents" : "pictures"), filename || `untitled.${extension}`),
    filters: [{ name: description || extension.toUpperCase(), extensions: [extension] }],
  })
  if (canceled || !filePath) return null
  await fs.promises.writeFile(filePath, Buffer.from(bytes))
  return filePath
})

/* ---------------- menu ---------------- */

function send(command) {
  if (win && !win.isDestroyed()) win.webContents.send("art-life:menu", command)
}

// registerAccelerator:false shows the shortcut in the menu but leaves the key to
// the renderer's own keyboard handler, so text fields keep working normally.
const item = (label, command, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => send(command) })

function buildMenu() {
  const template = [
    ...(isMac
      ? [{ label: APP_NAME, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }]
      : []),
    {
      label: "File",
      submenu: [
        item("New Canvas…", "new", "CmdOrCtrl+Alt+N"),
        { label: "Open…", accelerator: "CmdOrCtrl+O", registerAccelerator: false, click: showOpenDialog },
        { role: "recentDocuments", visible: isMac },
        { type: "separator" },
        item("Save Project (.dtm)…", "save", "CmdOrCtrl+S"),
        item("Export PNG…", "exportPNG"),
        item("Export SVG…", "exportSVG", "Shift+CmdOrCtrl+S"),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "undo", "CmdOrCtrl+Z"),
        item("Redo", "redo", "Shift+CmdOrCtrl+Z"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        item("Select All", "selectAll", "CmdOrCtrl+A"),
        item("Deselect", "deselect", "CmdOrCtrl+D"),
        item("Delete Selection", "delete", "Backspace"),
        { type: "separator" },
        item("Swap Colours", "swap", "X"),
      ],
    },
    {
      label: "Tools",
      submenu: [
        item("Selection", "tool:select", "V"),
        item("Direct Selection", "tool:direct", "A"),
        item("Move", "tool:move", "M"),
        item("Transform", "tool:transform", "T"),
        item("Freeform Select", "tool:lasso", "Q"),
        { type: "separator" },
        item("Brush", "tool:brush", "B"),
        item("Eraser", "tool:eraser", "E"),
        item("Live Paint Bucket", "tool:fill", "G"),
        item("Eyedropper", "tool:eyedropper", "I"),
        { type: "separator" },
        item("Line", "tool:line", "L"),
        item("Rectangle", "tool:rect", "U"),
        item("Ellipse", "tool:ellipse", "O"),
        item("Pen", "tool:pen", "P"),
        item("Add Anchor Point", "tool:penAdd", "Plus"),
        item("Delete Anchor Point", "tool:penDelete", "-"),
        item("Anchor Point (smooth / corner)", "tool:penConvert", "Shift+C"),
        { type: "separator" },
        item("Hand", "tool:hand", "H"),
        item("Zoom", "tool:zoom", "Z"),
      ],
    },
    {
      label: "Brushes",
      submenu: [
        item("Sketch Pencil — pressure", "brush:pencil-pressure", "1"),
        item("Tech Pencil — fixed", "brush:pencil-fixed", "2"),
        item("Pressure Ink — vector", "brush:vector-pressure", "3"),
        item("Mono Liner — vector", "brush:vector-fixed", "4"),
      ],
    },
    { label: "Layer", submenu: [item("New Pencil Layer", "newPencilLayer"), item("New Vector Layer", "newVectorLayer")] },
    {
      label: "View",
      submenu: [
        item("Zoom In", "zoomIn", "CmdOrCtrl+="),
        item("Zoom Out", "zoomOut", "CmdOrCtrl+-"),
        item("Fit to Window", "fit", "CmdOrCtrl+0"),
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------------- window ---------------- */

function createWindow() {
  rendererReady = false
  win = new BrowserWindow({
    title: APP_NAME,
    ...(fs.existsSync(WINDOW_ICON) && !isMac ? { icon: WINDOW_ICON } : {}),
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#222226",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once("ready-to-show", () => {
    win.maximize()
    win.show()
  })
  win.on("page-title-updated", (e) => e.preventDefault())
  win.webContents.on("did-start-loading", () => (rendererReady = false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://") && !(DEV && url.startsWith(DEV_URL))) e.preventDefault()
  })

  if (DEV) {
    const load = () => win.loadURL(DEV_URL).catch(() => setTimeout(load, 1000))
    load()
  } else {
    if (!fs.existsSync(path.join(rendererDir(), "index.html"))) {
      dialog.showErrorBox(APP_NAME, `The app build was not found at:\n${rendererDir()}\n\nRun "npm start" (it builds the app first).`)
    }
    win.loadURL("app://local/")
  }
}

// macOS: double-click a .dtm in Finder
app.on("open-file", (event, filePath) => {
  event.preventDefault()
  openPath(filePath)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows/Linux: double-click a .dtm while the app is already open
  app.on("second-instance", (_e, argv) => {
    const f = fileFromArgv(argv)
    if (f) openPath(f)
    else if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerAppProtocol()
    buildMenu()
    createWindow()
    const f = fileFromArgv(process.argv)
    if (f) openPath(f)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (!isMac) app.quit()
  })
}
