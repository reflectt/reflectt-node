import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import os from 'os';
import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers';
import { getStorage } from '@/lib/storage/storage-manager';

interface AudioTrack {
  path: string;
  volume?: number;
  offset?: number;
  fade_in?: number;
  fade_out?: number;
}

interface MixAudioInput {
  tracks: AudioTrack[] | string; // Allow JSON string or array
  output_format?: 'mp3' | 'wav';
  output_filename?: string;
  normalize?: boolean;
}

interface MixAudioOutput {
  success: boolean;
  audio_path?: string;
  duration_seconds?: number;
  track_count?: number;
  error?: string;
}

/**
 * Mix multiple audio files together using FFmpeg
 */
export default async function mix_audio(
  input: MixAudioInput,
  ctx: ToolContext
): Promise<MixAudioOutput> {
  try {
    const {
      tracks: rawTracks,
      output_format = 'mp3',
      output_filename,
      normalize = true
    } = input;

    // Parse tracks if it's a JSON string (LLM agents often pass parameters as strings)
    let tracks: AudioTrack[];
    if (typeof rawTracks === 'string') {
      try {
        tracks = JSON.parse(rawTracks);
      } catch (e) {
        return {
          success: false,
          error: `Failed to parse tracks: ${e instanceof Error ? e.message : String(e)}`
        };
      }
    } else if (Array.isArray(rawTracks)) {
      tracks = rawTracks;
    } else {
      return {
        success: false,
        error: 'tracks must be an array or JSON string'
      };
    }

    if (!tracks || tracks.length < 2) {
      return {
        success: false,
        error: 'At least 2 audio tracks are required for mixing'
      };
    }

    // Resolve all track paths
    const resolvedTracks = await Promise.all(
      tracks.map(async (track) => {
        let resolvedPath: string;
        
        if (path.isAbsolute(track.path)) {
          resolvedPath = track.path;
        } else if (track.path.startsWith('storage/')) {
          resolvedPath = ctx.resolvePath(undefined, track.path);
        } else {
          resolvedPath = ctx.resolvePath(undefined, 'storage', track.path);
        }

        // Check if file exists
        try {
          await fs.access(resolvedPath);
        } catch {
          throw new Error(`Audio file not found: ${track.path}`);
        }

        return {
          ...track,
          resolvedPath
        };
      })
    );

    // Generate output filename
    const timestamp = Date.now();
    const filename = output_filename
      ? `${output_filename}_${timestamp}.${output_format}`
      : `mixed_${timestamp}.${output_format}`;

    // Use temporary directory for FFmpeg processing
    const tempDir = os.tmpdir();
    const tempOutputPath = path.join(tempDir, filename);

    console.log(`[mix_audio] Mixing ${tracks.length} tracks...`);

    // Build FFmpeg command
    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      // Add all input files
      resolvedTracks.forEach(track => {
        command.input(track.resolvedPath);
      });

      // Build complex filter for mixing
      const filterParts: string[] = [];
      
      resolvedTracks.forEach((track, index) => {
        const filterComponents: string[] = [];
        
        // Apply volume
        if (track.volume !== undefined && track.volume !== 1.0) {
          filterComponents.push(`volume=${track.volume}`);
        }
        
        // Apply fade in
        if (track.fade_in && track.fade_in > 0) {
          filterComponents.push(`afade=t=in:st=0:d=${track.fade_in}`);
        }
        
        // Apply delay/offset
        if (track.offset && track.offset > 0) {
          filterComponents.push(`adelay=${Math.floor(track.offset * 1000)}|${Math.floor(track.offset * 1000)}`);
        }
        
        // Build the filter string
        if (filterComponents.length > 0) {
          const filter = `[${index}:a]${filterComponents.join(',')}[a${index}]`;
          filterParts.push(filter);
        } else {
          // No filters needed, just pass through with anull
          filterParts.push(`[${index}:a]anull[a${index}]`);
        }
      });

      // Mix all streams together
      const inputs = resolvedTracks.map((_, i) => `[a${i}]`).join('');
      const mixFilter = `${inputs}amix=inputs=${resolvedTracks.length}:duration=longest`;
      
      if (normalize) {
        filterParts.push(`${mixFilter}[mixed];[mixed]dynaudnorm[out]`);
      } else {
        filterParts.push(`${mixFilter}[out]`);
      }

      const complexFilter = filterParts.join(';');

      command
        .complexFilter(complexFilter)
        .outputOptions(['-map', '[out]'])
        .output(tempOutputPath);

      // Set output format options
      if (output_format === 'mp3') {
        command
          .audioCodec('libmp3lame')
          .audioBitrate('192k');
      } else {
        command.audioCodec('pcm_s16le');
      }

      command
        .on('start', (commandLine) => {
          console.log(`[mix_audio] FFmpeg command: ${commandLine}`);
        })
        .on('end', async () => {
          console.log(`[mix_audio] Mixing complete, uploading to storage...`);

          try {
            // Read the temporary file
            const audioBuffer = await fs.readFile(tempOutputPath);

            // Upload to storage
            const storage = getStorage();
            const storagePath = await storage.save(
              ctx.currentSpace,
              'audio/generated',
              filename,
              audioBuffer
            );

            // Clean up temp file
            await fs.unlink(tempOutputPath).catch(() => {});

            // Get duration of output file
            ffmpeg.ffprobe(tempOutputPath, (err, metadata) => {
              const duration = err ? undefined : metadata?.format?.duration;

              const relativePath = `storage/audio/generated/${filename}`;

              resolve({
                success: true,
                audio_path: relativePath,
                duration_seconds: duration ? parseFloat(duration.toFixed(2)) : undefined,
                track_count: tracks.length
              });
            });
          } catch (uploadError: any) {
            reject(new Error(`Failed to upload mixed audio: ${uploadError.message}`));
          }
        })
        .on('error', (err) => {
          console.error(`[mix_audio] FFmpeg error:`, err);
          reject(new Error(`FFmpeg mixing failed: ${err.message}`));
        })
        .run();
    });

  } catch (error: any) {
    console.error('[mix_audio] Error:', error);
    return {
      success: false,
      error: formatError(error)
    };
  }
}
