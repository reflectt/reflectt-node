// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Guardrails for `reflectt host connect`.
 *
 * Problem: running host connect on an already-enrolled machine can silently overwrite
 * ~/.reflectt/config.json and restart the server, taking down a production host.
 */

export interface ExistingCloudEnrollment {
  cloudUrl?: string
  hostId?: string
  credential?: string
  connectedAt?: number
  hostName?: string
  hostType?: string
}

export interface HostConnectGuardInput {
  existingCloud?: ExistingCloudEnrollment
  force?: boolean
}

export interface HostConnectGuardDecision {
  allow: boolean
  /** Human-readable warning for CLI output when allow=false */
  warning?: string
}

export function hostConnectGuard({ existingCloud, force }: HostConnectGuardInput): HostConnectGuardDecision {
  const hasExisting =
    !!existingCloud &&
    (Boolean(existingCloud.hostId) ||
      Boolean(existingCloud.credential) ||
      Boolean(existingCloud.cloudUrl) ||
      Boolean(existingCloud.connectedAt))

  if (!hasExisting) return { allow: true }
  if (force) return { allow: true }

  const parts: string[] = []
  if (existingCloud?.hostId) parts.push(`Host ID: ${existingCloud.hostId}`)
  if (existingCloud?.cloudUrl) parts.push(`Cloud URL: ${existingCloud.cloudUrl}`)

  const detail = parts.length ? `\n   ${parts.join('\n   ')}` : ''

  return {
    allow: false,
    warning:
      `⚠️  This machine is already enrolled with Reflectt Cloud.${detail}\n\n` +
      `Refusing to overwrite ~/.reflectt/config.json by default.\n\n` +
      `If you intend to replace the existing enrollment, re-run with:\n` +
      `  reflectt host connect --force ...\n`,
  }
}
