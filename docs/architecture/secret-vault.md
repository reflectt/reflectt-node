# Architecture: Encrypted Secret Vault

> Per-host key hierarchy with BYOK. Cloud stores ciphertext only.

## Overview

The secret vault provides secure credential storage for reflectt-cloud with a
zero-knowledge architecture: the cloud **never** sees plaintext secrets. Each host
holds its own encryption key; cloud stores only ciphertext and metadata.

## Threat Model

| Threat | Mitigation |
|---|---|
| Cloud database compromise | Ciphertext only — no plaintext secrets stored |
| Host compromise | Per-host keys — one host breach doesn't expose others |
| Man-in-the-middle | TLS + envelope encryption with host-specific keys |
| Insider access | Audit log for every decrypt/use event |
| Key loss | Key export + recovery via BYOK re-import |

## Key Hierarchy

```
Root (per-host)
├── Host Master Key (HMK) — generated on host, never leaves host
│   ├── stored in ~/.reflectt/secrets/host.key (file-permission protected)
│   └── optionally backed up by user (BYOK = Bring Your Own Key)
│
├── Data Encryption Keys (DEK) — one per secret
│   ├── generated on host at secret creation time
│   ├── DEK encrypted by HMK → stored in cloud as wrapped_dek
│   └── rotated independently per secret
│
└── Cloud Envelope
    ├── encrypted_value = AES-256-GCM(DEK, plaintext_secret)
    ├── wrapped_dek = AES-256-GCM(HMK, DEK)
    ├── iv, auth_tag per encryption
    └── metadata (name, scope, created_at, rotated_at) — plaintext
```

## Secret Scoping

Secrets are scoped to limit blast radius:

```
host-level:     Available to all projects on this host
project-level:  Available only within a specific project/team
agent-level:    Available only to a specific agent
```

Scope hierarchy: `agent < project < host`. An agent-scoped secret is only
decryptable by that agent's configured key derivation path.

## API Design

### Host-side (reflectt-node)

```
POST   /secrets                    Create/update a secret (encrypts locally, pushes ciphertext to cloud)
GET    /secrets                    List secrets (metadata only — no plaintext)
GET    /secrets/:name              Decrypt and return a secret (audit logged)
DELETE /secrets/:name              Revoke a secret (deletes from cloud + local cache)
POST   /secrets/:name/rotate       Rotate: re-encrypt with new DEK
GET    /secrets/export             Export all secrets (encrypted bundle for portability)
POST   /secrets/import             Import secrets bundle (re-wraps with current HMK)
GET    /secrets/audit              Access log for decrypt/use events
```

### Cloud-side (reflectt-cloud)

```
POST   /api/secrets/store          Store encrypted secret (ciphertext + wrapped DEK + metadata)
GET    /api/secrets/list            List secret metadata for a host
GET    /api/secrets/:id/fetch       Fetch ciphertext + wrapped DEK (host decrypts locally)
DELETE /api/secrets/:id             Delete secret
POST   /api/secrets/:id/rotate     Update ciphertext after host-side rotation
GET    /api/secrets/audit/:hostId   Audit log for a host's secret access
```

## Encryption Implementation

### Algorithm: AES-256-GCM
- **Why**: Authenticated encryption, hardware-accelerated on modern CPUs, widely audited
- **Key size**: 256-bit
- **IV**: 12 bytes, cryptographically random per encryption
- **Auth tag**: 16 bytes (128-bit)

### Key Generation

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

// Host Master Key — generated once, stored locally
function generateHMK(): Buffer {
  return randomBytes(32) // 256 bits
}

// Data Encryption Key — one per secret
function generateDEK(): Buffer {
  return randomBytes(32)
}

// Encrypt plaintext with a key (AES-256-GCM)
function encrypt(key: Buffer, plaintext: string): EncryptedPayload {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

// Decrypt ciphertext with a key
function decrypt(key: Buffer, payload: EncryptedPayload): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
```

### Secret Creation Flow

```
1. User: POST /secrets { name: "OPENAI_KEY", value: "sk-...", scope: "host" }
2. Host generates DEK
3. Host encrypts value: encrypted_value = encrypt(DEK, "sk-...")
4. Host wraps DEK: wrapped_dek = encrypt(HMK, DEK)
5. Host sends to cloud: { name, scope, encrypted_value, wrapped_dek, metadata }
6. Cloud stores ciphertext — never sees plaintext
7. Host caches DEK in memory (optional, TTL-based)
```

### Secret Retrieval Flow

```
1. Agent/system: GET /secrets/OPENAI_KEY
2. Host checks memory cache → if hit, decrypt and return
3. Host fetches from cloud: { encrypted_value, wrapped_dek }
4. Host unwraps DEK: DEK = decrypt(HMK, wrapped_dek)
5. Host decrypts value: plaintext = decrypt(DEK, encrypted_value)
6. Host logs audit event: { name, accessor, timestamp, action: "decrypt" }
7. Return plaintext to caller (never logged)
```

### Secret Rotation Flow

```
1. User: POST /secrets/OPENAI_KEY/rotate
2. Host fetches current ciphertext from cloud
3. Host decrypts with old DEK (unwrap old wrapped_dek first)
4. Host generates new DEK
5. Host re-encrypts plaintext with new DEK
6. Host wraps new DEK with HMK
7. Host pushes updated ciphertext + wrapped_dek to cloud
8. Audit: rotation event logged
```

## Audit Log

Every secret access is logged locally and synced to cloud:

```typescript
interface AuditEntry {
  timestamp: number
  secretName: string
  action: 'create' | 'read' | 'rotate' | 'delete' | 'export' | 'import'
  actor: string          // agent name or 'system'
  hostId: string
  success: boolean
  metadata?: {
    scope?: string
    reason?: string      // why was this secret accessed
  }
}
```

Audit log is append-only, stored in `~/.reflectt/secrets/audit.jsonl`.
Cloud receives audit events via heartbeat sync (no separate push needed).

## File Layout

```
~/.reflectt/
├── secrets/
│   ├── host.key           # Host Master Key (chmod 600)
│   ├── audit.jsonl        # Local audit log
│   └── cache/             # Optional encrypted DEK cache
├── .gitignore             # Excludes secrets/ directory
```

## Export / Portability

`GET /secrets/export` produces an encrypted bundle:

```json
{
  "version": "1.0.0",
  "exported_at": "2026-02-16T...",
  "host_id": "mac-daddy",
  "secrets": [
    {
      "name": "OPENAI_KEY",
      "scope": "host",
      "encrypted_value": "...",
      "wrapped_dek": "...",
      "iv": "...",
      "authTag": "..."
    }
  ],
  "export_key_hint": "Re-import requires the original HMK or a new HMK (re-wrap)"
}
```

Import with a new HMK: the system unwraps DEKs with the old HMK, re-wraps
with the new one. This enables host migration without re-entering secrets.

## Security Constraints

1. **HMK never leaves the host** — not synced to cloud, not in backups unless user explicitly exports
2. **No plaintext in logs** — audit log records access events, never secret values
3. **File permissions** — `host.key` is `chmod 600` (owner-only read/write)
4. **Memory safety** — DEK cache entries have TTL, plaintext zeroed after use
5. **No key in env vars** — HMK loaded from file, not environment
6. **Rotation doesn't require downtime** — old DEK valid until rotation completes

## Implementation Phases

### Phase 1: Local vault (this PR)
- `src/secrets.ts` — encryption/decryption, key management, audit logging
- Host-side API endpoints in `src/server.ts`
- `~/.reflectt/secrets/` directory structure
- `reflectt init` creates secrets directory with proper permissions

### Phase 2: Cloud sync
- Cloud storage endpoints for ciphertext
- Heartbeat-based audit sync
- Host provisioning pulls encrypted secrets on first connect

### Phase 3: Advanced features
- Agent-scoped key derivation
- Automatic rotation schedules
- Hardware security module (HSM) support for HMK
- Multi-host secret sharing via re-wrapping
