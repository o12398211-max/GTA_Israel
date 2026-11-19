import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;

function webgl2Available(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

if (!webgl2Available()) {
  document.getElementById('loading-tip')!.textContent = 'הדפדפן שלך לא תומך ב-WebGL2. גם הרכבת לירושלים לא תמיד מגיעה, אבל הפעם זה עליך.';
} else {
  const game = new Game(canvas);
  game.load().catch((err) => {
    console.error(err);
    document.getElementById('loading-tip')!.textContent = `שגיאה בטעינה: ${err?.message ?? err}`;
  });
}
