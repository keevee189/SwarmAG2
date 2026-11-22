/**
 * Shared audio, header wiring, and utility helpers for Nexus Arcade.
 * Safe to import in both browser modules and Node.js unit tests.
 */

const MUTE_STORAGE_KEY = 'nexus-arcade:muted';

interface SynthNote {
  freq: number;
  endFreq?: number;
  delay?: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

type AudioContextCtor = typeof AudioContext;

/**
 * Synthesizes crisp Web Audio arcade sound effects without external audio assets.
 */
export class ArcadeAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(nextMuted: boolean): boolean {
    this.muted = Boolean(nextMuted);
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public playClick(): void {
    this.playSequence([{ freq: 640, endFreq: 860, duration: 0.055, type: 'triangle', gain: 0.07 }]);
  }

  public playMove(): void {
    this.playSequence([{ freq: 320, endFreq: 420, duration: 0.06, type: 'sine', gain: 0.06 }]);
  }

  public playMatch(): void {
    this.playSequence([
      { freq: 523.25, duration: 0.08, type: 'triangle', gain: 0.08 },
      { freq: 659.25, delay: 0.06, duration: 0.1, type: 'triangle', gain: 0.08 },
      { freq: 783.99, delay: 0.12, duration: 0.13, type: 'sine', gain: 0.09 },
    ]);
  }

  public playScore(): void {
    this.playSequence([
      { freq: 587.33, duration: 0.07, type: 'square', gain: 0.05 },
      { freq: 880, delay: 0.06, duration: 0.12, type: 'triangle', gain: 0.08 },
    ]);
  }

  public playWin(): void {
    this.playSequence([
      { freq: 523.25, duration: 0.11, type: 'triangle', gain: 0.09 },
      { freq: 659.25, delay: 0.09, duration: 0.11, type: 'triangle', gain: 0.09 },
      { freq: 783.99, delay: 0.18, duration: 0.12, type: 'triangle', gain: 0.09 },
      { freq: 1046.5, delay: 0.28, duration: 0.26, type: 'sine', gain: 0.11 },
    ]);
  }

  public playLose(): void {
    this.playSequence([
      { freq: 392, endFreq: 311.13, duration: 0.15, type: 'sawtooth', gain: 0.06 },
      { freq: 311.13, endFreq: 233.08, delay: 0.14, duration: 0.22, type: 'sawtooth', gain: 0.06 },
      { freq: 220, endFreq: 146.83, delay: 0.3, duration: 0.3, type: 'triangle', gain: 0.08 },
    ]);
  }

  public playError(): void {
    this.playSequence([
      { freq: 190, endFreq: 140, duration: 0.1, type: 'sawtooth', gain: 0.07 },
      { freq: 150, endFreq: 110, delay: 0.08, duration: 0.12, type: 'sawtooth', gain: 0.06 },
    ]);
  }

  private getContext(): AudioContext | null {
    if (this.muted) {
      return null;
    }
    try {
      if (typeof window === 'undefined') {
        return null;
      }
      if (!this.ctx) {
        const win = window as unknown as {
          AudioContext?: AudioContextCtor;
          webkitAudioContext?: AudioContextCtor;
        };
        const Ctor = win.AudioContext ?? win.webkitAudioContext;
        if (!Ctor) {
          return null;
        }
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playSequence(notes: SynthNote[]): void {
    try {
      const ctx = this.getContext();
      if (!ctx) {
        return;
      }
      const baseTime = ctx.currentTime;
      for (const note of notes) {
        const start = baseTime + (note.delay ?? 0);
        const end = start + Math.max(0.02, note.duration);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type;
        osc.frequency.setValueAtTime(note.freq, start);
        if (note.endFreq !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, note.endFreq), end);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(note.gain, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.01);
      }
    } catch {
      // Headless or locked audio contexts must never break gameplay.
    }
  }
}

export const ArcadeAudio = new ArcadeAudioEngine();

function readStoredMute(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredMute(muted: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    }
  } catch {
    // Ignore storage quota or sandbox restrictions.
  }
}

function syncMuteButton(btn: HTMLElement, muted: boolean): void {
  btn.setAttribute('aria-pressed', String(muted));
  btn.setAttribute('data-muted', String(muted));
  btn.setAttribute('title', muted ? 'Unmute arcade audio' : 'Mute arcade audio');

  const labelEl = btn.querySelector<HTMLElement>('[data-mute-label]');
  if (labelEl) {
    labelEl.textContent = muted ? 'Muted' : 'Sound On';
  }
  const iconEl = btn.querySelector<HTMLElement>('[data-mute-icon]');
  if (iconEl) {
    iconEl.textContent = muted ? '🔇' : '🔊';
  }
  if (!labelEl && !iconEl && btn.children.length === 0) {
    btn.textContent = muted ? '🔇 Muted' : '🔊 Sound On';
  }
}

/**
 * Wires `[data-mute-toggle]` controls in the arcade header and restores mute state.
 */
export function initArcadeHeader(): void {
  try {
    if (typeof document === 'undefined') {
      return;
    }
    const initialMuted = readStoredMute();
    ArcadeAudio.setMuted(initialMuted);

    const buttons = document.querySelectorAll<HTMLElement>('[data-mute-toggle]');
    buttons.forEach((btn) => {
      syncMuteButton(btn, ArcadeAudio.isMuted());
      if (btn.dataset.arcadeBound === 'true') {
        return;
      }
      btn.dataset.arcadeBound = 'true';
      btn.addEventListener('click', () => {
        const nextMuted = ArcadeAudio.toggleMute();
        writeStoredMute(nextMuted);
        document.querySelectorAll<HTMLElement>('[data-mute-toggle]').forEach((el) => {
          syncMuteButton(el, nextMuted);
        });
        if (!nextMuted) {
          ArcadeAudio.playClick();
        }
      });
    });
  } catch {
    // Safe no-op outside browser DOM.
  }
}

/**
 * Formats a non-negative duration in seconds as `MM:SS`.
 */
export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Clamps `v` into the inclusive `[min, max]` interval.
 */
export function clamp(v: number, min: number, max: number): number {
  const lo = min <= max ? min : max;
  const hi = min <= max ? max : min;
  if (Number.isNaN(v)) {
    return lo;
  }
  return Math.min(hi, Math.max(lo, v));
}
