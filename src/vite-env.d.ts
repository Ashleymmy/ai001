/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
    saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
    openProject: () => Promise<string | null>
    saveProject: (data: unknown) => Promise<boolean>
    getSystemInfo: () => Promise<{ platform: string; arch: string; version?: string; isPackaged?: boolean; gpuInfo?: string }>
  }
}
