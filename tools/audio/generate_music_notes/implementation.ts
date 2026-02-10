import fs from 'fs/promises';
import path from 'path';
import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers';
import { getStorage } from '@/lib/storage/storage-manager';

/**
 * Note to frequency mapping (A4 = 440Hz)
 */
const NOTE_FREQUENCIES: Record<string, number> = {
  'C0': 16.35, 'C#0': 17.32, 'D0': 18.35, 'D#0': 19.45, 'E0': 20.60, 'F0': 21.83, 'F#0': 23.12, 'G0': 24.50, 'G#0': 25.96, 'A0': 27.50, 'A#0': 29.14, 'B0': 30.87,
  'C1': 32.70, 'C#1': 34.65, 'D1': 36.71, 'D#1': 38.89, 'E1': 41.20, 'F1': 43.65, 'F#1': 46.25, 'G1': 49.00, 'G#1': 51.91, 'A1': 55.00, 'A#1': 58.27, 'B1': 61.74,
  'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
  'C6': 1046.50, 'C#6': 1108.73, 'D6': 1174.66, 'D#6': 1244.51, 'E6': 1318.51, 'F6': 1396.91, 'F#6': 1479.98, 'G6': 1567.98, 'G#6': 1661.22, 'A6': 1760.00, 'A#6': 1864.66, 'B6': 1975.53,
  'C7': 2093.00, 'C#7': 2217.46, 'D7': 2349.32, 'D#7': 2489.02, 'E7': 2637.02, 'F7': 2793.83, 'F#7': 2959.96, 'G7': 3135.96, 'G#7': 3322.44, 'A7': 3520.00, 'A#7': 3729.31, 'B7': 3951.07,
  'C8': 4186.01
};

/**
 * Generate a simple waveform
 */
function generateWaveform(
  frequency: number,
  duration: number,
  sampleRate: number,
  waveform: 'sine' | 'square' | 'sawtooth' | 'triangle',
  volume: number
): Float32Array {
  const numSamples = Math.floor(duration * sampleRate);
  const samples = new Float32Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * frequency * t;
    
    let sample = 0;
    switch (waveform) {
      case 'sine':
        sample = Math.sin(phase);
        break;
      case 'square':
        sample = Math.sin(phase) > 0 ? 1 : -1;
        break;
      case 'sawtooth':
        sample = 2 * ((frequency * t) % 1) - 1;
        break;
      case 'triangle':
        sample = 2 * Math.abs(2 * ((frequency * t) % 1) - 1) - 1;
        break;
    }
    
    // Apply ADSR envelope (simple version)
    const attackTime = 0.01;
    const releaseTime = 0.1;
    let envelope = 1;
    
    if (t < attackTime) {
      envelope = t / attackTime;
    } else if (t > duration - releaseTime) {
      envelope = (duration - t) / releaseTime;
    }
    
    samples[i] = sample * volume * envelope;
  }
  
  return samples;
}

/**
 * Mix multiple audio samples
 */
function mixSamples(samples: Float32Array[]): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (samples.length === 1) return samples[0];
  
  const maxLength = Math.max(...samples.map(s => s.length));
  const mixed = new Float32Array(maxLength);
  
  for (let i = 0; i < maxLength; i++) {
    let sum = 0;
    for (const sample of samples) {
      if (i < sample.length) {
        sum += sample[i];
      }
    }
    mixed[i] = Math.max(-1, Math.min(1, sum / samples.length));
  }
  
  return mixed;
}

/**
 * Create a WAV file buffer from audio data
 */
function createWavFile(audioData: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioData.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    buffer.writeInt16LE(pcm, offset);
    offset += 2;
  }

  return buffer;
}

type Note = string | string[];

interface GenerateMusicNotesInput {
  instrument: 'piano' | 'guitar' | 'bass' | 'drums' | 'synth' | 'strings' | 'brass' | 'woodwind';
  notes: Note[];
  durations?: number[];
  tempo?: number;
  volume?: number;
  repeat?: number;
  output_filename?: string;
}

interface GenerateMusicNotesOutput {
  success: boolean;
  audio_path?: string;
  duration_seconds?: number;
  note_count?: number;
  error?: string;
}

/**
 * Get instrument waveform and envelope settings
 */
interface InstrumentSettings {
  waveform: 'sine' | 'square' | 'sawtooth' | 'triangle';
  attack: number;
  release: number;
}

function getInstrumentSettings(type: string): InstrumentSettings {
  switch (type) {
    case 'piano':
      return { waveform: 'sine', attack: 0.005, release: 1.0 };
    case 'guitar':
      return { waveform: 'triangle', attack: 0.01, release: 0.5 };
    case 'bass':
      return { waveform: 'sawtooth', attack: 0.01, release: 0.2 };
    case 'drums':
      return { waveform: 'sine', attack: 0.001, release: 0.4 };
    case 'synth':
      return { waveform: 'square', attack: 0.005, release: 0.1 };
    case 'strings':
      return { waveform: 'sawtooth', attack: 0.4, release: 1.2 };
    case 'brass':
      return { waveform: 'square', attack: 0.05, release: 0.3 };
    case 'woodwind':
      return { waveform: 'sine', attack: 0.1, release: 0.5 };
    default:
      return { waveform: 'sine', attack: 0.01, release: 0.5 };
  }
}

/**
 * Generate musical notes/chords using pure Node.js synthesis
 */
export default async function generate_music_notes(
  input: GenerateMusicNotesInput,
  ctx: ToolContext
): Promise<GenerateMusicNotesOutput> {
  try {
    const {
      instrument,
      notes: rawNotes,
      durations: rawDurations,
      tempo = 120,
      volume = 0.8,
      repeat = 1,
      output_filename
    } = input;

    // Parse notes if it's a JSON string
    let notes: Note[];
    if (typeof rawNotes === 'string') {
      try {
        notes = JSON.parse(rawNotes);
      } catch (e) {
        return {
          success: false,
          error: `Failed to parse notes: ${e instanceof Error ? e.message : String(e)}`
        };
      }
    } else if (Array.isArray(rawNotes)) {
      notes = rawNotes;
    } else {
      // Single note
      notes = [rawNotes];
    }

    // Parse durations if it's a JSON string
    let durations: number[] | undefined;
    if (typeof rawDurations === 'string') {
      try {
        durations = JSON.parse(rawDurations);
      } catch (e) {
        return {
          success: false,
          error: `Failed to parse durations: ${e instanceof Error ? e.message : String(e)}`
        };
      }
    } else {
      durations = rawDurations;
    }

    if (!notes || notes.length === 0) {
      return {
        success: false,
        error: 'Notes array cannot be empty'
      };
    }

    // Validate durations length if provided
    if (durations && durations.length !== notes.length) {
      return {
        success: false,
        error: `Durations array length (${durations.length}) must match notes array length (${notes.length})`
      };
    }

    console.log(`[generate_music_notes] Generating ${notes.length} notes, ${repeat} repeats...`);

    // Get instrument settings
    const instrumentSettings = getInstrumentSettings(instrument);
    const sampleRate = 44100; // CD quality
    const beatDuration = 60 / tempo; // seconds per beat
    const noteDurations = (durations && durations.length > 0) ? durations : notes.map(() => 1);
    
    // Calculate total duration
    let totalDuration = 0;
    for (let rep = 0; rep < repeat; rep++) {
      for (const duration of noteDurations) {
        totalDuration += duration * beatDuration;
      }
    }

    // Create audio buffer for the entire piece
    const totalSamples = Math.floor((totalDuration + 0.5) * sampleRate);
    const audioBuffer = new Float32Array(totalSamples);
    
    // Generate each note and add to buffer
    let currentTime = 0;
    
    for (let rep = 0; rep < repeat; rep++) {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const duration = noteDurations[i] * beatDuration;
        const startSample = Math.floor(currentTime * sampleRate);
        
        if (Array.isArray(note)) {
          // Chord - mix multiple notes
          const chordSamples: Float32Array[] = [];
          for (const singleNote of note) {
            const freq = NOTE_FREQUENCIES[singleNote];
            if (freq) {
              chordSamples.push(
                generateWaveform(freq, duration, sampleRate, instrumentSettings.waveform, volume / note.length)
              );
            }
          }
          
          if (chordSamples.length > 0) {
            const mixed = mixSamples(chordSamples);
            // Add to audio buffer
            for (let j = 0; j < mixed.length && startSample + j < audioBuffer.length; j++) {
              audioBuffer[startSample + j] += mixed[j];
            }
          }
        } else {
          // Single note
          const freq = NOTE_FREQUENCIES[note];
          if (freq) {
            const noteSamples = generateWaveform(freq, duration, sampleRate, instrumentSettings.waveform, volume);
            // Add to audio buffer
            for (let j = 0; j < noteSamples.length && startSample + j < audioBuffer.length; j++) {
              audioBuffer[startSample + j] += noteSamples[j];
            }
          } else {
            console.warn(`[generate_music_notes] Unknown note: ${note}`);
          }
        }
        
        currentTime += duration;
      }
    }

    // Normalize audio to prevent clipping
    let maxAmplitude = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(audioBuffer[i]));
    }
    if (maxAmplitude > 1) {
      for (let i = 0; i < audioBuffer.length; i++) {
        audioBuffer[i] /= maxAmplitude;
      }
    }

    // Create WAV file
    const wavBuffer = createWavFile(audioBuffer, sampleRate);

    // Generate filename
    const timestamp = Date.now();
    const filename = output_filename
      ? `${output_filename}_${timestamp}.wav`
      : `music_${instrument}_${timestamp}.wav`;

    // Save to storage
    const storage = getStorage();
    await storage.save(
      ctx.currentSpace,
      'audio/generated',
      filename,
      wavBuffer
    );

    const relativePath = `storage/audio/generated/${filename}`;

    console.log(`[generate_music_notes] Audio saved to: ${relativePath}`);

    return {
      success: true,
      audio_path: relativePath,
      duration_seconds: parseFloat(totalDuration.toFixed(2)),
      note_count: notes.length * repeat
    };

  } catch (error: any) {
    console.error('[generate_music_notes] Error:', error);
    return {
      success: false,
      error: formatError(error)
    };
  }
}
