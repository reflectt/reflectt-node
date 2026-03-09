// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { createHash } from 'node:crypto'
import type { BuildInfo } from './buildInfo.js'

export interface RawHostErrorSample {
  timestamp: number
  method?: string
  url?: string
  status?: number
  message: string
}

export interface DeployTransitionMetadata {
  currentCommit: string | null
  previousCommit: string | null
  startupCommit: string | null
  signature: string
  changedSinceStartup: boolean
  withinGrace?: boolean
}

export interface HostErrorFingerprintEvent {
  contractVersion: 'host-error-fingerprint.v1'
  host_id: string
  repo: string
  runtime: {
    appVersion: string
    nodeVersion: string
    pid: number
  }
  timestamp: number
  deploy: DeployTransitionMetadata
  normalized_fingerprint: string
  normalized_message: string
  subsystem: string
  status: number | null
  method: string | null
  sample_message: string
  sample_url: string | null
}

const MAX_SAMPLE_MESSAGE = 240

function truncate(input: string, max = MAX_SAMPLE_MESSAGE): string {
  const text = String(input || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function normalizeCommit(value?: string | null): string | null {
  const raw = String(value || '').trim().toLowerCase()
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : null
}

function normalizeUrl(url?: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  return raw
    .replace(/\?.*$/, '')
    .replace(/\/task-\d+-[a-z0-9-]+/gi, '/:taskId')
    .replace(/\/msg-\d+-[a-z0-9-]+/gi, '/:messageId')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/[a-f0-9]{7,40}(?=\/|$)/gi, '/:sha')
    .replace(/\/\d{2,}(?=\/|$)/g, '/:id')
}

export function normalizeErrorMessage(message: string): string {
  const raw = String(message || '').trim().toLowerCase()
  if (!raw) return 'unknown error'

  return raw
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/task-\d+-[a-z0-9-]+/g, 'task-:id')
    .replace(/msg-\d+-[a-z0-9-]+/g, 'msg-:id')
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, ':uuid')
    .replace(/\b[0-9a-f]{7,40}\b/g, ':sha')
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/g, ':timestamp')
    .replace(/\b\d{10,13}\b/g, ':timestamp')
    .replace(/\b\d{2,}(ms|s|m|h)\b/g, ':n$1')
    .replace(/\b\d{2,}\b/g, ':n')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferSubsystem(url?: string, message?: string): string {
  const haystack = `${normalizeUrl(url)} ${String(message || '').toLowerCase()}`
  if (/^\/api\/hosts\b|\bcloud\b|\bheartbeat\b/.test(haystack)) return 'cloud'
  if (/^\/chat\b|\bchat\b|\binbox\b/.test(haystack)) return 'chat'
  if (/^\/tasks\b|\btask\b|\breview\b/.test(haystack)) return 'tasks'
  if (/^\/canvas\b|\bcanvas\b/.test(haystack)) return 'canvas'
  if (/^\/health\b|\bhealth\b|\bdoctor\b/.test(haystack)) return 'health'
  if (/^\/preflight\b|\bpreflight\b/.test(haystack)) return 'preflight'
  return 'core'
}

export function computeNormalizedFingerprint(sample: RawHostErrorSample): { normalizedMessage: string; fingerprint: string; subsystem: string; normalizedUrl: string } {
  const normalizedMessage = normalizeErrorMessage(sample.message)
  const normalizedUrl = normalizeUrl(sample.url)
  const subsystem = inferSubsystem(sample.url, sample.message)
  const method = String(sample.method || '').trim().toUpperCase() || 'INTERNAL'
  const status = Number.isFinite(sample.status) ? Number(sample.status) : 0
  const basis = [subsystem, method, status, normalizedUrl || 'no-url', normalizedMessage].join('|')
  const fingerprint = createHash('sha256').update(basis).digest('hex').slice(0, 16)
  return { normalizedMessage, fingerprint, subsystem, normalizedUrl }
}

export function buildDeployTransition(input: {
  currentCommit?: string | null
  previousCommit?: string | null
  startupCommit?: string | null
  withinGrace?: boolean
}): DeployTransitionMetadata {
  const currentCommit = normalizeCommit(input.currentCommit)
  const previousCommit = normalizeCommit(input.previousCommit)
  const startupCommit = normalizeCommit(input.startupCommit)
  const changedSinceStartup = Boolean(currentCommit && startupCommit && currentCommit !== startupCommit)
  const signature = previousCommit && currentCommit
    ? `${previousCommit.slice(0, 12)}→${currentCommit.slice(0, 12)}`
    : currentCommit
      ? `deploy:${currentCommit.slice(0, 12)}`
      : 'deploy:unknown'

  return {
    currentCommit,
    previousCommit,
    startupCommit,
    signature,
    changedSinceStartup,
    withinGrace: input.withinGrace,
  }
}

export function buildHostErrorFingerprintEvent(input: {
  hostId: string
  repo?: string
  buildInfo: BuildInfo
  deploy: DeployTransitionMetadata
  sample: RawHostErrorSample
}): HostErrorFingerprintEvent {
  const computed = computeNormalizedFingerprint(input.sample)

  return {
    contractVersion: 'host-error-fingerprint.v1',
    host_id: input.hostId,
    repo: input.repo || 'reflectt-node',
    runtime: {
      appVersion: input.buildInfo.appVersion,
      nodeVersion: input.buildInfo.nodeVersion,
      pid: input.buildInfo.pid,
    },
    timestamp: input.sample.timestamp,
    deploy: input.deploy,
    normalized_fingerprint: computed.fingerprint,
    normalized_message: computed.normalizedMessage,
    subsystem: computed.subsystem,
    status: Number.isFinite(input.sample.status) ? Number(input.sample.status) : null,
    method: input.sample.method ? String(input.sample.method).toUpperCase() : null,
    sample_message: truncate(input.sample.message),
    sample_url: computed.normalizedUrl || null,
  }
}

export function buildHostErrorFingerprintBatch(input: {
  hostId: string
  buildInfo: BuildInfo
  deploy: DeployTransitionMetadata
  samples: RawHostErrorSample[]
  repo?: string
  limit?: number
}): HostErrorFingerprintEvent[] {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50))
  return input.samples
    .slice(0, limit)
    .map(sample => buildHostErrorFingerprintEvent({
      hostId: input.hostId,
      repo: input.repo,
      buildInfo: input.buildInfo,
      deploy: input.deploy,
      sample,
    }))
}
