/** Bridge exposed by the Electron preload (apps/vite/electron/preload.cjs). Undefined in the browser. */
export interface ArtLifeBridge {
  isDesktop: true
  platform: string
  saveFile(bytes: Uint8Array, opts: { filename: string; description: string; ext: string }): Promise<string | null>
  onMenu(callback: (command: string) => void): () => void
  onOpenFile(callback: (file: { name: string; text: string }) => void): () => void
}

declare global {
  interface Window {
    artLife?: ArtLifeBridge
  }
}

export const desktop: ArtLifeBridge | undefined = typeof window !== "undefined" ? window.artLife : undefined
