const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("artLife", {
  isDesktop: true,
  platform: process.platform,
  saveFile: (bytes, opts) => ipcRenderer.invoke("art-life:save-file", { bytes, ...opts }),
  onMenu: (callback) => {
    const handler = (_event, command) => callback(command)
    ipcRenderer.on("art-life:menu", handler)
    return () => ipcRenderer.removeListener("art-life:menu", handler)
  },
  onOpenFile: (callback) => {
    const handler = (_event, file) => callback(file)
    ipcRenderer.on("art-life:open-file", handler)
    ipcRenderer.send("art-life:renderer-ready")
    return () => ipcRenderer.removeListener("art-life:open-file", handler)
  },
})
