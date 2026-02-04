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

declare module 'wavesurfer.js' {
  export type WaveSurferOptions = {
    container: HTMLElement
    height?: number
    waveColor?: string
    progressColor?: string
    cursorColor?: string
  }

  export type WaveSurferEventHandler = (...args: any[]) => void

  export interface WaveSurferInstance {
    on: (event: string, handler: WaveSurferEventHandler) => WaveSurferInstance
    once: (event: string, handler: WaveSurferEventHandler) => WaveSurferInstance
    un: (event: string, handler: WaveSurferEventHandler) => WaveSurferInstance
    load: (url: string) => void
    play: (start?: number, end?: number) => void
    pause: () => void
    isPlaying: () => boolean
    getDuration: () => number
    getCurrentTime: () => number
    seekTo: (progress: number) => void
    setTime?: (seconds: number) => void
    destroy: () => void
  }

  const WaveSurfer: {
    create: (options: WaveSurferOptions) => WaveSurferInstance
  }

  export default WaveSurfer
}
