import type { Game } from '../core/Game';
import { gameStore, type Settings } from '../state/store';
import type { NetClient } from '../net/NetClient';
import type { Avatar, GameMode } from '../../shared/protocol';

const T = {
  he: {
    paused: 'הפסקה', resume: 'המשך', settings: 'הגדרות', multiplayer: 'מולטיפלייר', controls: 'שליטה', story: 'סיפור',
    quality: 'איכות גרפיקה', low: 'נמוכה', medium: 'בינונית', high: 'גבוהה', mouse: 'רגישות עכבר', invert: 'היפוך ציר Y',
    master: 'ווליום כללי', sfx: 'אפקטים', music: 'מוזיקה', language: 'שפה', subtitles: 'כתוביות', tts: 'דיבוב (TTS מקומי)',
    reload: 'שינוי איכות ייכנס לתוקף אחרי טעינה מחדש', apply: 'טען מחדש עכשיו',
    server: 'כתובת שרת', name: 'כינוי', room: 'קוד חדר', avatar: 'אווטאר', mode: 'מצב משחק', connect: 'התחבר', disconnect: 'התנתק',
    freeroam: 'עולם פתוח', race: 'מירוץ איילון', arena: 'ארנה: מה הצבעת?', random: 'אקראי',
    mpHelp: 'מריצים שרת: npm run server (או Docker). עד 8 שחקנים בחדר. Enter לצ\'אט.',
    resetSave: 'התחל סיפור מחדש', ttsNA: '(אין קול עברי במערכת – כתוביות בלבד)',
  },
  en: {
    paused: 'Paused', resume: 'Resume', settings: 'Settings', multiplayer: 'Multiplayer', controls: 'Controls', story: 'Story',
    quality: 'Graphics quality', low: 'Low', medium: 'Medium', high: 'High', mouse: 'Mouse sensitivity', invert: 'Invert Y',
    master: 'Master volume', sfx: 'Effects', music: 'Music', language: 'Language', subtitles: 'Subtitles', tts: 'Voice (local TTS)',
    reload: 'Quality changes apply after reload', apply: 'Reload now',
    server: 'Server URL', name: 'Nickname', room: 'Room code', avatar: 'Avatar', mode: 'Mode', connect: 'Connect', disconnect: 'Disconnect',
    freeroam: 'Free roam', race: 'Ayalon race', arena: 'Arena: what did you vote?', random: 'Random',
    mpHelp: 'Run a server: npm run server (or Docker). Up to 8 players per room. Enter to chat.',
    resetSave: 'Restart story', ttsNA: '(no Hebrew voice installed – subtitles only)',
  },
};

/** Pause menu (Esc): settings, multiplayer lobby, controls. */
export class Menu {
  private el: HTMLDivElement;
  open = false;
  private tab: 'settings' | 'multiplayer' | 'controls' = 'settings';

  constructor(private game: Game, private net: NetClient) {
    this.el = document.createElement('div');
    this.el.id = 'menu';
    document.body.appendChild(this.el);
    this.applySettings(gameStore.getState().settings);
    gameStore.subscribe((s, p) => { if (s.settings !== p.settings) this.applySettings(s.settings); });
  }

  private get t() { return T[gameStore.getState().settings.language]; }

  toggle(force?: boolean, tab?: Menu['tab']) {
    this.open = force ?? !this.open;
    if (tab) this.tab = tab;
    this.el.classList.toggle('open', this.open);
    gameStore.setState({ phase: this.open ? 'paused' : 'playing' });
    if (this.open) { document.exitPointerLock?.(); this.render(); }
  }

  private applySettings(s: Settings) {
    this.game.input.mouseSensitivity = 0.0025 * s.mouseSensitivity;
    this.game.input.invertY = s.invertY;
    this.game.audio.setVolumes(s.master, s.sfx, s.music);
    document.documentElement.lang = s.language;
    document.getElementById('hud-help')!.innerHTML = s.language === 'en'
      ? '<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>F</b> vehicle · <b>Click/R</b> punch · <b>H</b> horn · <b>Tab</b> switch character · <b>P</b> phone · <b>Esc</b> menu'
      : '<b>WASD</b> תנועה · <b>Shift</b> ספרינט · <b>רווח</b> קפיצה · <b>F</b> רכב · <b>קליק/R</b> אגרוף · <b>H</b> צופר · <b>Tab</b> החלפת דמות · <b>P</b> טלפון · <b>Esc</b> תפריט';
  }

  private set(patch: Partial<Settings>) { gameStore.setState({ settings: { ...gameStore.getState().settings, ...patch } }); }

  private render() {
    const t = this.t, s = gameStore.getState().settings;
    const tabs = (['settings', 'multiplayer', 'controls'] as const).map((k) => `<button class="tab ${this.tab === k ? 'on' : ''}" data-tab="${k}">${t[k]}</button>`).join('');
    let body = '';
    if (this.tab === 'settings') {
      const sel = (k: keyof Settings, opts: [string, string][]) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const range = (k: keyof Settings, min: number, max: number, step: number) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}">`;
      const chk = (k: keyof Settings) => `<input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}>`;
      body = `<label>${t.quality} ${sel('quality', [['low', t.low], ['medium', t.medium], ['high', t.high]])}</label>
        <p class="note qnote" hidden>${t.reload} <button class="reload">${t.apply}</button></p>
        <label>${t.mouse} ${range('mouseSensitivity', 0.2, 3, 0.1)}</label>
        <label>${t.invert} ${chk('invertY')}</label>
        <label>${t.master} ${range('master', 0, 1, 0.05)}</label>
        <label>${t.sfx} ${range('sfx', 0, 1, 0.05)}</label>
        <label>${t.music} ${range('music', 0, 1, 0.05)}</label>
        <label>${t.language} ${sel('language', [['he', 'עברית'], ['en', 'English']])}</label>
        <label>${t.subtitles} ${chk('subtitles')}</label>
        <label>${t.tts} ${chk('tts')} <small>${this.game.dialog.ttsAvailable ? '' : t.ttsNA}</small></label>
        <button class="danger reset">${t.resetSave}</button>`;
    } else if (this.tab === 'multiplayer') {
      const params = new URLSearchParams(location.search);
      const def = params.get('server') ?? localStorage.getItem('mp-server') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8787`;
      body = `<p class="note">${t.mpHelp}</p>
        <label>${t.server} <input class="srv" value="${def}"></label>
        <label>${t.name} <input class="nm" maxlength="16" value="${localStorage.getItem('mp-name') ?? (gameStore.getState().character === 'noa' ? 'נועה' : 'אבי')}"></label>
        <label>${t.room} <input class="rm" maxlength="12" value="${localStorage.getItem('mp-room') ?? 'TLV'}"></label>
        <label>${t.avatar} <select class="av"><option value="avi">אבי</option><option value="noa">נועה</option><option value="random">${t.random}</option></select></label>
        <label>${t.mode} <select class="md"><option value="freeroam">${t.freeroam}</option><option value="race">${t.race}</option><option value="arena">${t.arena}</option></select></label>
        <p class="status">${this.net.connected ? `✅ ${this.net.room}` : ''}</p>
        ${this.net.connected ? `<button class="dc">${t.disconnect}</button>` : `<button class="cn">${t.connect}</button>`}`;
    } else {
      body = `<table class="keys">
        <tr><td>WASD / סטיק שמאלי</td><td>תנועה · נהיגה</td></tr><tr><td>עכבר / סטיק ימני</td><td>מצלמה</td></tr>
        <tr><td>Shift / RB</td><td>ספרינט</td></tr><tr><td>C / Ctrl</td><td>הליכה איטית</td></tr><tr><td>רווח / A</td><td>קפיצה · טיפוס · בלם יד</td></tr>
        <tr><td>F / Y</td><td>כניסה ויציאה מרכב</td></tr><tr><td>קליק / R / X</td><td>אגרוף</td></tr><tr><td>E / B</td><td>פעולה · סירנה</td></tr>
        <tr><td>H / L3</td><td>צופר</td></tr><tr><td>Tab / Select</td><td>החלפת דמות (אבי ↔ נועה)</td></tr><tr><td>P / D-pad ↑</td><td>טלפון</td></tr>
        <tr><td>מטוס</td><td>W/S מצערת · A/D גלגול · ↑/↓ עלרוד · Q/E הגה</td></tr><tr><td>T</td><td>זמן מהיר</td></tr><tr><td>Enter</td><td>צ'אט (מולטיפלייר)</td></tr></table>`;
    }
    this.el.innerHTML = `<div class="panel"><div class="logo-sm">VI <span>Israel</span></div><h2>${t.paused}</h2><div class="tabs">${tabs}</div><div class="body">${body}</div>
      <button class="resume">${t.resume}</button></div>`;
    this.el.querySelector('.resume')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab as Menu['tab']; this.render(); }));
    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.k as keyof Settings;
      const v = inp instanceof HTMLInputElement && inp.type === 'checkbox' ? inp.checked : inp instanceof HTMLInputElement && inp.type === 'range' ? Number(inp.value) : inp.value;
      this.set({ [k]: v } as Partial<Settings>);
      if (k === 'quality') (this.el.querySelector('.qnote') as HTMLElement).hidden = false;
      if (k === 'language') this.render();
    }));
    this.el.querySelector('.reload')?.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.delete('quality'); location.href = u.toString(); });
    this.el.querySelector('.reset')?.addEventListener('click', () => { gameStore.setState({ missionIndex: 0 }); this.game.hud.toast('הסיפור אופס. המשימה הראשונה מחכה בטיילת.'); });
    this.el.querySelector('.cn')?.addEventListener('click', async () => {
      const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
      const url = q<HTMLInputElement>('.srv').value.trim(), name = q<HTMLInputElement>('.nm').value, room = q<HTMLInputElement>('.rm').value;
      const avatar = q<HTMLSelectElement>('.av').value as Avatar, mode = q<HTMLSelectElement>('.md').value as GameMode;
      localStorage.setItem('mp-server', url); localStorage.setItem('mp-name', name); localStorage.setItem('mp-room', room);
      const st = this.el.querySelector('.status') as HTMLElement;
      st.textContent = '…';
      try {
        await this.net.connect(url, room, name, avatar, mode);
        if (avatar !== 'random' && avatar !== gameStore.getState().character) this.game.switchCharacter(avatar);
        if (mode === 'arena') this.game.teleport({ x: -240, z: 112 });
        this.toggle(false);
      } catch (e) { st.textContent = `❌ ${(e as Error).message}`; }
    });
    this.el.querySelector('.dc')?.addEventListener('click', () => { this.net.disconnect(); this.render(); });
  }
}
