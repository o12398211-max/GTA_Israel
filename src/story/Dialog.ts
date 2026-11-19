import dialogs from '../data/dialogs.json';
import type { Game } from '../core/Game';
import { gameStore } from '../state/store';
import type { SkinnedCharacter } from '../entities/SkinnedCharacter';

export interface Line { speaker: string; text: string; duration?: number }
export type DialogId = keyof typeof dialogs;

/**
 * Dialogue playback: subtitles + optional local TTS (Web Speech API, Hebrew
 * voice if the OS has one) + talking animation on the speaking character.
 * Lines advance automatically or with Space/Enter/click.
 */
export class DialogSystem {
  private voice: SpeechSynthesisVoice | null = null;
  speakers = new Map<string, SkinnedCharacter>();

  constructor(private game: Game) {
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices() ?? [];
      this.voice = vs.find((v) => v.lang.startsWith('he')) ?? null;
    };
    if ('speechSynthesis' in window) { pick(); window.speechSynthesis.onvoiceschanged = pick; }
  }

  get ttsAvailable() { return !!this.voice; }

  lines(id: DialogId): Line[] { return (dialogs as Record<string, Line[]>)[id] ?? []; }

  async play(id: DialogId | Line[], opts: { skippable?: boolean } = {}): Promise<void> {
    const lines = typeof id === 'string' ? this.lines(id) : id;
    const st = gameStore.getState().settings;
    for (const l of lines) {
      const dur = l.duration ?? Math.max(1.8, 0.9 + l.text.length * 0.055);
      if (st.subtitles) this.game.hud.setSubtitle(l.speaker, l.text);
      const ch = this.speakers.get(l.speaker);
      if (ch) { ch.talk = 1; if (!ch.forced) ch.forced = 'talk'; }
      if (st.tts && this.voice && /[֐-׿]/.test(l.text)) {
        const u = new SpeechSynthesisUtterance(l.text);
        u.voice = this.voice; u.lang = this.voice.lang; u.rate = 1.05;
        u.pitch = l.speaker === 'אמא' || l.speaker === 'נועה' || l.speaker === 'תיירת' ? 1.25 : 0.95;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
      await this.wait(dur, opts.skippable !== false);
      if (ch) { ch.talk = 0; if (ch.forced === 'talk') ch.forced = null; }
    }
    this.game.hud.setSubtitle(null, null);
  }

  /** Waits `sec` of game time; Space/Enter/click skips ahead. */
  private wait(sec: number, skippable: boolean): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const tick = { update: (dt: number) => {
        t += dt;
        const skip = skippable && t > 0.3 && (this.game.input.wasPressed('Space') || this.game.input.wasPressed('Enter') || this.game.input.wasPressed('Mouse0'));
        if (t >= sec || skip) { this.game.systems.splice(this.game.systems.indexOf(tick), 1); resolve(); }
      } };
      this.game.systems.push(tick);
    });
  }
}
