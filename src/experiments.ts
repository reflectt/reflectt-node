// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Experiment tracking manager
 * Stores experiment records in JSONL and provides active experiment queries.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'

export type ExperimentStatus = 'planned' | 'active' | 'paused' | 'completed' | 'canceled'
export type ExperimentType =
  | 'fake-door'
  | 'pricing'
  | 'messaging'
  | 'onboarding'
  | 'activation'
  | 'retention'
  | 'other'

export interface Experiment {
  id: string
  name: string
  hypothesis: string
  type: ExperimentType
  owner: string
  status: ExperimentStatus
  startAt?: number
  endAt?: number | null
  metricPrimary: string
  metricGuardrail?: string
  channel?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

const EXPERIMENTS_FILE = join(DATA_DIR, 'experiments.jsonl')
const LEGACY_EXPERIMENTS_FILE = join(LEGACY_DATA_DIR, 'experiments.jsonl')

class ExperimentsManager {
  private experiments = new Map<string, Experiment>()
  private initialized = false

  constructor() {
    this.loadExperiments().catch(err => {
      console.error('[Experiments] Failed to load experiments:', err)
    })
  }

  private async loadExperiments(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      let loaded = false
      try {
        const content = await fs.readFile(EXPERIMENTS_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)

        for (const line of lines) {
          try {
            const exp = JSON.parse(line) as Experiment
            this.experiments.set(exp.id, exp)
          } catch (err) {
            console.error('[Experiments] Failed to parse line:', err)
          }
        }

        loaded = true
        console.log(`[Experiments] Loaded ${this.experiments.size} experiments from disk`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
      }

      if (!loaded) {
        try {
          const legacy = await fs.readFile(LEGACY_EXPERIMENTS_FILE, 'utf-8')
          const lines = legacy.trim().split('\n').filter(line => line.length > 0)

          for (const line of lines) {
            try {
              const exp = JSON.parse(line) as Experiment
              this.experiments.set(exp.id, exp)
            } catch (err) {
              console.error('[Experiments] Failed to parse legacy line:', err)
            }
          }

          console.log(`[Experiments] Migrated ${this.experiments.size} experiments from legacy location`)

          if (this.experiments.size > 0) {
            await this.persistExperiments()
            console.log('[Experiments] Migration complete - experiments saved to new location')
          }
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.error('[Experiments] Failed to migrate from legacy location:', err)
          } else {
            console.log('[Experiments] No existing experiments file, starting fresh')
          }
        }
      }
    } finally {
      this.initialized = true
    }
  }

  private async persistExperiments(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      const lines = Array.from(this.experiments.values()).map(exp => JSON.stringify(exp))
      await fs.writeFile(EXPERIMENTS_FILE, lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      console.error('[Experiments] Failed to persist experiments:', err)
    }
  }

  async createExperiment(data: {
    name: string
    hypothesis: string
    type: ExperimentType
    owner: string
    status: ExperimentStatus
    startAt?: number
    endAt?: number | null
    metricPrimary: string
    metricGuardrail?: string
    channel?: string
    notes?: string
  }): Promise<Experiment> {
    const now = Date.now()
    const experiment: Experiment = {
      id: `exp-${now}-${Math.random().toString(36).slice(2, 9)}`,
      name: data.name,
      hypothesis: data.hypothesis,
      type: data.type,
      owner: data.owner,
      status: data.status,
      startAt: data.startAt,
      endAt: data.endAt ?? null,
      metricPrimary: data.metricPrimary,
      metricGuardrail: data.metricGuardrail,
      channel: data.channel,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
    }

    this.experiments.set(experiment.id, experiment)
    await this.persistExperiments()
    return experiment
  }

  getActiveExperiments(): Experiment[] {
    return Array.from(this.experiments.values())
      .filter(exp => exp.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getStats() {
    const byStatus: Record<ExperimentStatus, number> = {
      planned: 0,
      active: 0,
      paused: 0,
      completed: 0,
      canceled: 0,
    }

    for (const exp of this.experiments.values()) {
      byStatus[exp.status] += 1
    }

    return {
      initialized: this.initialized,
      total: this.experiments.size,
      byStatus,
    }
  }
}

export const experimentsManager = new ExperimentsManager()
