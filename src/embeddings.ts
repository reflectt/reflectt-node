// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// @xenova/transformers is an optional dependency — may not be installed
// if sharp fails to build (e.g. Node 25+). Embeddings gracefully degrade.
let pipeline: any
try {
  pipeline = (await import('@xenova/transformers')).pipeline
} catch {
  pipeline = null
}

const DEFAULT_MODEL = process.env.REFLECTT_EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2'

type FeatureExtractor = (input: string | string[], options?: Record<string, unknown>) => Promise<unknown>

let extractorPromise: Promise<FeatureExtractor> | null = null

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function getExtractor(): Promise<FeatureExtractor> {
  if (!pipeline) {
    throw new Error('Embeddings unavailable: @xenova/transformers is not installed. Install it with: npm install @xenova/transformers')
  }
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', DEFAULT_MODEL) as Promise<FeatureExtractor>
  }
  return extractorPromise
}

function toFloat32Array(value: unknown): Float32Array {
  if (value instanceof Float32Array) return value

  if (Array.isArray(value)) {
    // Handle [[...]] or [...] cases
    if (value.length > 0 && Array.isArray(value[0])) {
      return new Float32Array((value[0] as number[]).map(Number))
    }
    return new Float32Array((value as number[]).map(Number))
  }

  if (value && typeof value === 'object') {
    const maybeData = (value as any).data
    if (maybeData instanceof Float32Array) return maybeData
    if (Array.isArray(maybeData)) return new Float32Array(maybeData.map(Number))
  }

  throw new Error('Unexpected embedding output shape')
}

/**
 * Embed a single text into a normalized float32 vector.
 * Model is lazily downloaded/loaded on first call.
 */
export async function embed(text: string): Promise<Float32Array> {
  if (!isNonEmptyString(text)) {
    throw new Error('embed(text): text is required')
  }

  const extractor = await getExtractor()
  const out = await extractor(text, { pooling: 'mean', normalize: true })
  return toFloat32Array(out)
}

/**
 * Embed a batch of texts into normalized float32 vectors.
 * Preserves input order.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (!Array.isArray(texts) || texts.length === 0) return []
  if (texts.some((t) => !isNonEmptyString(t))) {
    throw new Error('embedBatch(texts): all texts must be non-empty strings')
  }

  const extractor = await getExtractor()
  const out = await extractor(texts, { pooling: 'mean', normalize: true })

  if (Array.isArray(out)) {
    return out.map(toFloat32Array)
  }

  // Some runtimes may return a tensor-like object with nested lists in `tolist`
  const maybeToList = (out as any)?.tolist
  if (typeof maybeToList === 'function') {
    const asList = maybeToList.call(out)
    if (Array.isArray(asList)) {
      return asList.map((row) => toFloat32Array(row))
    }
  }

  // Fallback: if a single tensor comes back for one item, normalize to batch shape.
  return [toFloat32Array(out)]
}

export function embeddingModelId(): string {
  return DEFAULT_MODEL
}

export function resetEmbeddingCacheForTests(): void {
  extractorPromise = null
}
