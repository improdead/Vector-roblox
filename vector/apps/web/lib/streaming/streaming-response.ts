/**
 * Real-Time LLM Streaming System
 * Fix for Issue #1: No Real-Time LLM Streaming
 *
 * Provides character-by-character or token-by-token streaming for LLM responses
 * so users can see incremental progress instead of waiting for complete responses.
 */

export interface StreamingResponse {
  /**
   * Register a callback for partial results as they stream in
   */
  onPartialResult(callback: (partial: string) => void): void;

  /**
   * Register a callback for when streaming completes
   */
  onComplete(callback: (final: string) => void): void;

  /**
   * Register a callback for errors during streaming
   */
  onError(callback: (error: Error) => void): void;

  /**
   * Cancel the ongoing stream
   */
  cancel(): void;

  /**
   * Get the accumulated response so far
   */
  getCurrentResponse(): string;
}

export interface StreamingProvider {
  /**
   * Call the LLM with streaming enabled
   */
  callStreaming(options: StreamingCallOptions): Promise<StreamingResponse>;
}

export interface StreamingCallOptions {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  onPartial?: (partial: string) => void;
  onComplete?: (final: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Implementation of StreamingResponse with cancellation support
 */
export class StreamingResponseImpl implements StreamingResponse {
  private partialCallbacks: Array<(partial: string) => void> = [];
  private completeCallbacks: Array<(final: string) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private currentResponse: string = '';
  private cancelled: boolean = false;
  private abortController: AbortController = new AbortController();

  onPartialResult(callback: (partial: string) => void): void {
    this.partialCallbacks.push(callback);
  }

  onComplete(callback: (final: string) => void): void {
    this.completeCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController.abort();
  }

  getCurrentResponse(): string {
    return this.currentResponse;
  }

  /**
   * Internal method to emit partial results
   */
  emitPartial(partial: string): void {
    if (this.cancelled) return;
    this.currentResponse += partial;
    this.partialCallbacks.forEach(cb => {
      try {
        cb(partial);
      } catch (err) {
        console.error('Error in partial callback:', err);
      }
    });
  }

  /**
   * Internal method to emit completion
   */
  emitComplete(final: string): void {
    if (this.cancelled) return;
    this.currentResponse = final;
    this.completeCallbacks.forEach(cb => {
      try {
        cb(final);
      } catch (err) {
        console.error('Error in complete callback:', err);
      }
    });
  }

  /**
   * Internal method to emit errors
   */
  emitError(error: Error): void {
    this.errorCallbacks.forEach(cb => {
      try {
        cb(error);
      } catch (err) {
        console.error('Error in error callback:', err);
      }
    });
  }

  /**
   * Get the abort signal for fetch cancellation
   */
  getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Check if the stream was cancelled
   */
  isCancelled(): boolean {
    return this.cancelled;
  }
}

/**
 * Streaming Orchestrator - manages LLM streaming with event emission
 */
export class StreamingOrchestrator {
  private streamKey: string;

  constructor(streamKey: string) {
    this.streamKey = streamKey;
  }

  /**
   * Run LLM with streaming support
   */
  async runLLM(
    provider: StreamingProvider,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    model: string,
    apiKey: string
  ): Promise<StreamingResponse> {
    const stream = await provider.callStreaming({
      systemPrompt,
      messages,
      model,
      apiKey,
      onPartial: (partial) => this.pushChunk(this.streamKey, partial),
      onComplete: (final) => this.pushComplete(this.streamKey, final),
      onError: (error) => this.pushError(this.streamKey, error),
    });

    return stream;
  }

  /**
   * Push a chunk to the stream bus
   */
  private pushChunk(streamKey: string, chunk: string): void {
    // Integration point with existing stream bus
    // This would connect to the existing /api/stream system
    if (typeof (globalThis as any).streamBus !== 'undefined') {
      (globalThis as any).streamBus.emit(streamKey, {
        type: 'partial',
        content: chunk,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Push completion to the stream bus
   */
  private pushComplete(streamKey: string, final: string): void {
    if (typeof (globalThis as any).streamBus !== 'undefined') {
      (globalThis as any).streamBus.emit(streamKey, {
        type: 'complete',
        content: final,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Push error to the stream bus
   */
  private pushError(streamKey: string, error: Error): void {
    if (typeof (globalThis as any).streamBus !== 'undefined') {
      (globalThis as any).streamBus.emit(streamKey, {
        type: 'error',
        error: error.message,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Example OpenRouter streaming provider implementation
 */
export class OpenRouterStreamingProvider implements StreamingProvider {
  private baseUrl: string = 'https://openrouter.ai/api/v1';

  async callStreaming(options: StreamingCallOptions): Promise<StreamingResponse> {
    const response = new StreamingResponseImpl();

    // Start streaming in background
    this.streamFromAPI(options, response).catch(err => {
      response.emitError(err);
    });

    return response;
  }

  private async streamFromAPI(
    options: StreamingCallOptions,
    response: StreamingResponseImpl
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          ...options.messages,
        ],
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      }),
      signal: response.getAbortSignal(),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || response.isCancelled()) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                response.emitPartial(content);
                if (options.onPartial) options.onPartial(content);
              }
            } catch (err) {
              console.warn('Failed to parse SSE line:', line, err);
            }
          }
        }
      }

      // Only emit completion if not cancelled
      if (!response.isCancelled()) {
        const final = response.getCurrentResponse();
        response.emitComplete(final);
        if (options.onComplete) options.onComplete(final);
      }

    } catch (error) {
      if (!response.isCancelled()) {
        const err = error instanceof Error ? error : new Error(String(error));
        response.emitError(err);
        if (options.onError) options.onError(err);
      }
    } finally {
      reader.releaseLock();
    }
  }
}
