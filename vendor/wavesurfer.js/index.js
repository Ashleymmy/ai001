function clamp(value, min, max) {
  const v = Number.isFinite(value) ? value : 0
  return Math.max(min, Math.min(max, v))
}

function ensureElement(el) {
  if (!el) throw new Error('WaveSurfer: container is required')
  return el
}

function resolveContainer(container) {
  if (!container) return null
  if (typeof container === 'string') return document.querySelector(container)
  return container
}

function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!getAudioContext._ctx) getAudioContext._ctx = new Ctx()
  return getAudioContext._ctx
}

export default class WaveSurfer {
  static create(options) {
    return new WaveSurfer(options)
  }

  constructor(options) {
    this.options = options || {}
    this._events = new Map()
    this._raf = null
    this._stopAt = null
    this._decodedDuration = 0
    this._isPlaying = false

    this.container = ensureElement(resolveContainer(this.options.container))

    this._buildDom()
    this._bindAudio()
  }

  _buildDom() {
    this.container.innerHTML = ''

    const height = typeof this.options.height === 'number' ? this.options.height : 120

    this.wrapper = document.createElement('div')
    this.wrapper.style.position = 'relative'
    this.wrapper.style.width = '100%'
    this.wrapper.style.height = `${height}px`
    this.wrapper.style.borderRadius = '12px'
    this.wrapper.style.overflow = 'hidden'

    this.canvas = document.createElement('canvas')
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.display = 'block'

    this.progressLine = document.createElement('div')
    this.progressLine.style.position = 'absolute'
    this.progressLine.style.top = '0'
    this.progressLine.style.bottom = '0'
    this.progressLine.style.width = '2px'
    this.progressLine.style.left = '0%'
    this.progressLine.style.background = this.options.cursorColor || 'rgba(255,255,255,0.8)'
    this.progressLine.style.pointerEvents = 'none'

    this.wrapper.appendChild(this.canvas)
    this.wrapper.appendChild(this.progressLine)
    this.container.appendChild(this.wrapper)

    this.wrapper.addEventListener('click', (e) => {
      const rect = this.wrapper.getBoundingClientRect()
      const x = e.clientX - rect.left
      const p = rect.width > 0 ? x / rect.width : 0
      this.seekTo(p)
    })

    const handleResize = () => {
      try {
        this._renderCached()
      } catch {
        // ignore
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(handleResize)
      this._resizeObserver.observe(this.wrapper)
    } else {
      this._resizeObserver = null
      this._onWindowResize = handleResize
      window.addEventListener('resize', handleResize)
    }
  }

  _bindAudio() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.crossOrigin = 'anonymous'

    this._onLoadedMeta = () => {
      this._emit('ready')
      this._updateProgress()
    }
    this._onEnded = () => {
      this._isPlaying = false
      this._stopRaf()
      this._emit('finish')
      this._emit('pause')
    }
    this._onError = () => {
      const err = new Error('WaveSurfer: audio load/playback failed')
      this._emit('error', err)
    }

    this.audio.addEventListener('loadedmetadata', this._onLoadedMeta)
    this.audio.addEventListener('ended', this._onEnded)
    this.audio.addEventListener('error', this._onError)
  }

  on(event, handler) {
    if (!event || typeof handler !== 'function') return this
    if (!this._events.has(event)) this._events.set(event, new Set())
    this._events.get(event).add(handler)
    return this
  }

  once(event, handler) {
    if (!event || typeof handler !== 'function') return this
    const wrapped = (...args) => {
      this.un(event, wrapped)
      handler(...args)
    }
    return this.on(event, wrapped)
  }

  un(event, handler) {
    const set = this._events.get(event)
    if (!set) return this
    set.delete(handler)
    return this
  }

  _emit(event, ...args) {
    const set = this._events.get(event)
    if (!set || set.size === 0) return
    for (const fn of Array.from(set)) {
      try {
        fn(...args)
      } catch {
        // ignore handler errors
      }
    }
  }

  load(url) {
    const u = (url || '').toString().trim()
    if (!u) return
    this._stopAt = null
    this._isPlaying = false
    this._stopRaf()
    try {
      this.audio.pause()
      this.audio.currentTime = 0
    } catch {
      // ignore
    }
    this.audio.src = u
    this.audio.load()
    void this._decodeAndDraw(u)
  }

  async _decodeAndDraw(url) {
    this._cachedPeaks = null
    this._cachedUrl = url
    const ctx = getAudioContext()
    if (!ctx) return

    let ab
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      ab = await res.arrayBuffer()
    } catch (e) {
      this._emit('error', e instanceof Error ? e : new Error(String(e || 'fetch failed')))
      return
    }

    let audioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(ab.slice(0))
    } catch (e) {
      this._emit('error', e instanceof Error ? e : new Error('decode failed'))
      return
    }

    this._decodedDuration = audioBuffer.duration || 0

    const data = audioBuffer.getChannelData(0)
    if (!data || data.length === 0) return

    const rect = this.wrapper.getBoundingClientRect()
    const widthCss = Math.max(1, Math.floor(rect.width || 1))
    const heightCss = Math.max(1, Math.floor(rect.height || 1))
    const dpr = window.devicePixelRatio || 1

    this.canvas.width = Math.floor(widthCss * dpr)
    this.canvas.height = Math.floor(heightCss * dpr)

    const peaks = new Float32Array(widthCss)
    const step = Math.max(1, Math.floor(data.length / widthCss))
    for (let i = 0; i < widthCss; i++) {
      const start = i * step
      const end = Math.min(data.length, start + step)
      let peak = 0
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j])
        if (v > peak) peak = v
      }
      peaks[i] = peak
    }

    this._cachedPeaks = peaks
    this._cachedHeightCss = heightCss
    this._cachedWidthCss = widthCss

    this._draw(peaks, widthCss, heightCss, dpr)
    this._updateProgress()
  }

  _renderCached() {
    if (!this._cachedPeaks || !this.wrapper) return
    const rect = this.wrapper.getBoundingClientRect()
    const widthCss = Math.max(1, Math.floor(rect.width || 1))
    const heightCss = Math.max(1, Math.floor(rect.height || 1))
    const dpr = window.devicePixelRatio || 1

    // If width changed, recompute peaks by simple resample (no re-decode).
    let peaks = this._cachedPeaks
    if (widthCss !== this._cachedWidthCss) {
      const next = new Float32Array(widthCss)
      for (let i = 0; i < widthCss; i++) {
        const p = i / Math.max(1, widthCss - 1)
        const src = Math.floor(p * Math.max(1, this._cachedWidthCss - 1))
        next[i] = peaks[src] || 0
      }
      peaks = next
      this._cachedPeaks = peaks
      this._cachedWidthCss = widthCss
    }

    this.canvas.width = Math.floor(widthCss * dpr)
    this.canvas.height = Math.floor(heightCss * dpr)
    this._draw(peaks, widthCss, heightCss, dpr)
    this._updateProgress()
  }

  _draw(peaks, widthCss, heightCss, dpr) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    const mid = heightCss / 2
    const waveColor = this.options.waveColor || 'rgba(147,197,253,0.55)'
    const progressColor = this.options.progressColor || 'rgba(236,72,153,0.75)'

    const progress = this.getDuration() > 0 ? clamp(this.getCurrentTime() / this.getDuration(), 0, 1) : 0
    const progressX = Math.floor(progress * widthCss)

    for (let x = 0; x < widthCss; x++) {
      const p = peaks[x] || 0
      const h = Math.max(1, p * mid)
      ctx.fillStyle = x <= progressX ? progressColor : waveColor
      ctx.fillRect(x, mid - h, 1, h * 2)
    }

    ctx.restore()
  }

  _startRaf() {
    if (this._raf) return
    const tick = () => {
      if (!this._isPlaying) {
        this._raf = null
        return
      }

      this._updateProgress()
      this._emit('audioprocess', this.getCurrentTime())

      if (typeof this._stopAt === 'number' && Number.isFinite(this._stopAt)) {
        if (this.getCurrentTime() >= this._stopAt - 0.02) {
          this.pause()
          this._stopAt = null
          this._emit('finish')
          return
        }
      }

      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  _stopRaf() {
    if (!this._raf) return
    cancelAnimationFrame(this._raf)
    this._raf = null
  }

  _updateProgress() {
    const d = this.getDuration()
    const t = this.getCurrentTime()
    const p = d > 0 ? clamp(t / d, 0, 1) : 0
    this.progressLine.style.left = `${(p * 100).toFixed(3)}%`
    if (this._cachedPeaks) {
      // lightweight progress update without full redraw.
      // (we don't redraw on every tick to keep it cheap)
    }
  }

  play(start, end) {
    if (typeof start === 'number' && Number.isFinite(start)) {
      this.setTime(start)
    }
    this._stopAt = typeof end === 'number' && Number.isFinite(end) ? end : null
    const p = this.audio.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        this._isPlaying = true
        this._emit('play')
        this._startRaf()
      }).catch((e) => {
        this._emit('error', e instanceof Error ? e : new Error(String(e || 'play failed')))
      })
    } else {
      this._isPlaying = true
      this._emit('play')
      this._startRaf()
    }
  }

  pause() {
    try {
      this.audio.pause()
    } catch {
      // ignore
    }
    const was = this._isPlaying
    this._isPlaying = false
    this._stopRaf()
    if (was) this._emit('pause')
  }

  isPlaying() {
    return Boolean(this._isPlaying)
  }

  getDuration() {
    const d = Number(this.audio.duration)
    if (Number.isFinite(d) && d > 0) return d
    return Number.isFinite(this._decodedDuration) ? this._decodedDuration : 0
  }

  getCurrentTime() {
    const t = Number(this.audio.currentTime)
    return Number.isFinite(t) ? t : 0
  }

  seekTo(progress) {
    const d = this.getDuration()
    if (!d || !Number.isFinite(d)) return
    const p = clamp(progress, 0, 1)
    this.setTime(p * d)
  }

  setTime(seconds) {
    const d = this.getDuration()
    const t = clamp(seconds, 0, d > 0 ? d : Number.MAX_SAFE_INTEGER)
    try {
      this.audio.currentTime = t
    } catch {
      // ignore
    }
    this._updateProgress()
    this._emit('seek', t)
  }

  destroy() {
    try {
      this.pause()
    } catch {
      // ignore
    }
    try {
      if (this.audio) {
        this.audio.removeEventListener('loadedmetadata', this._onLoadedMeta)
        this.audio.removeEventListener('ended', this._onEnded)
        this.audio.removeEventListener('error', this._onError)
        this.audio.src = ''
      }
    } catch {
      // ignore
    }
    try {
      if (this._resizeObserver && this.wrapper) this._resizeObserver.unobserve(this.wrapper)
    } catch {
      // ignore
    }
    try {
      if (this._onWindowResize) window.removeEventListener('resize', this._onWindowResize)
    } catch {
      // ignore
    }
    this._resizeObserver = null
    this._onWindowResize = null
    this._events.clear()
    if (this.container) this.container.innerHTML = ''
  }
}
