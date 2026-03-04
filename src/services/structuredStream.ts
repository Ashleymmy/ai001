/**
 * Structured Stream Consumer
 * Consumes SSE streams that emit structured JSON events (delta/complete/error).
 * Uses fetch + ReadableStream instead of EventSource for POST support
 * and finer control over the streaming protocol.
 */

import { BACKEND_ORIGIN, getStoredAccessToken, getStoredWorkspaceId } from './api'

// ---------------------------------------------------------------------------
// Event types matching the backend structured-streaming protocol
// ---------------------------------------------------------------------------

export interface StreamDeltaEvent {
  type: 'delta'
  content: string
  accumulated: string
}

export interface StreamProgressEvent {
  type: 'progress'
  percentage: number
}

export interface StreamCompleteEvent<T = unknown> {
  type: 'complete'
  content: string
  parsed: T
}

export interface StreamErrorEvent {
  type: 'error'
  message: string
}

export type StreamEvent<T = unknown> =
  | StreamDeltaEvent
  | StreamProgressEvent
  | StreamCompleteEvent<T>
  | StreamErrorEvent

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ConsumeStreamOptions<T> {
  /** Called for each delta chunk with the partial accumulated text */
  onDelta?: (accumulated: string, delta: string) => void
  /** Called on progress updates */
  onProgress?: (percentage: number) => void
  /** Called when stream completes with the full parsed result */
  onComplete?: (result: T) => void
  /** Called on error */
  onError?: (error: string) => void
  /** AbortController signal for cancellation */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Consume a structured SSE stream from the backend.
 *
 * The backend sends `text/event-stream` responses where each SSE message
 * carries a JSON payload with `type` equal to `delta`, `progress`,
 * `complete`, or `error`.
 *
 * @example
 * ```ts
 * const result = await consumeStructuredStream<CharacterProfile[]>(
 *   '/api/agent/stream/character-profile',
 *   {
 *     onDelta: (accumulated) => setPartialResult(accumulated),
 *     onComplete: (profiles) => setProfiles(profiles),
 *     onError: (err) => showError(err),
 *   }
 * );
 * ```
 *
 * @returns The final parsed result on `complete`, or `null` if the stream
 *          ended without a complete event (e.g. aborted or errored).
 */
export async function consumeStructuredStream<T = unknown>(
  url: string,
  options: ConsumeStreamOptions<T> = {},
): Promise<T | null> {
  const { onDelta, onProgress, onComplete, onError, signal } = options

  // Build full URL – accept both absolute and relative paths
  const fullUrl = url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`

  // Attach auth headers the same way the axios instances do
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  }
  const token = getStoredAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const workspaceId = getStoredWorkspaceId()
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const response = await fetch(fullUrl, { headers, signal })

  if (!response.ok) {
    const message = `Stream request failed: ${response.status} ${response.statusText}`
    onError?.(message)
    return null
  }

  const body = response.body
  if (!body) {
    const message = 'Response body is not readable'
    onError?.(message)
    return null
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: T | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines.
      // Process all complete events currently in the buffer.
      const parts = buffer.split('\n\n')
      // The last element is either empty or an incomplete event – keep it.
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const event = parseSSEEvent<T>(part)
        if (!event) continue

        switch (event.type) {
          case 'delta':
            onDelta?.((event as StreamDeltaEvent).accumulated, (event as StreamDeltaEvent).content)
            break
          case 'progress':
            onProgress?.((event as StreamProgressEvent).percentage)
            break
          case 'complete':
            result = (event as StreamCompleteEvent<T>).parsed
            onComplete?.(result)
            break
          case 'error':
            onError?.((event as StreamErrorEvent).message)
            break
        }
      }
    }

    // Flush any remaining data in the buffer (some servers may not send a
    // trailing double-newline after the last event).
    if (buffer.trim()) {
      const event = parseSSEEvent<T>(buffer)
      if (event) {
        switch (event.type) {
          case 'delta':
            onDelta?.((event as StreamDeltaEvent).accumulated, (event as StreamDeltaEvent).content)
            break
          case 'progress':
            onProgress?.((event as StreamProgressEvent).percentage)
            break
          case 'complete':
            result = (event as StreamCompleteEvent<T>).parsed
            onComplete?.(result)
            break
          case 'error':
            onError?.((event as StreamErrorEvent).message)
            break
        }
      }
    }
  } catch (err: unknown) {
    // AbortError is expected when the caller cancels via signal
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null
    }
    const message = err instanceof Error ? err.message : String(err)
    onError?.(message)
    return null
  } finally {
    // Ensure the reader is released even on early return / error
    reader.releaseLock()
  }

  return result
}

// ---------------------------------------------------------------------------
// SSE parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a single SSE event block into a typed StreamEvent.
 *
 * An SSE block looks like:
 * ```
 * data: {"type":"delta","content":"he","accumulated":"The he"}
 * ```
 *
 * Lines starting with `:` are comments and are ignored.
 * Only the `data` field is used; `event`, `id`, and `retry` are ignored.
 */
function parseSSEEvent<T>(raw: string): StreamEvent<T> | null {
  const lines = raw.split('\n')
  const dataLines: string[] = []

  for (const line of lines) {
    // SSE spec: lines starting with colon are comments
    if (line.startsWith(':')) continue

    if (line.startsWith('data:')) {
      // "data:" or "data: " – trim the prefix
      dataLines.push(line.slice(line.charAt(5) === ' ' ? 6 : 5))
    }
    // Ignore other SSE fields (event, id, retry)
  }

  if (dataLines.length === 0) return null

  const payload = dataLines.join('\n')

  // Some servers send "data: [DONE]" as a termination signal
  if (payload === '[DONE]') return null

  try {
    return JSON.parse(payload) as StreamEvent<T>
  } catch {
    return null
  }
}
