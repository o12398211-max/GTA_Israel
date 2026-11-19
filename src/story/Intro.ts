import type { Game } from '../core/Game';
import type { Shot } from './Cutscene';
import { gameStore } from '../state/store';

function logoOverlay(extra = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'vi-logo-screen';
  el.innerHTML = `<div class="logo" aria-label="VI Israel"><span class="logo-vi">VI</span><span class="logo-israel">Israel</span></div>${extra}`;
  document.body.appendChild(el);
  return el;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opening: black → VI Israel logo (glow) → aerial pan over the city → Avi. */
export async function playIntro(game: Game) {
  const cs = game.cutscene;
  cs.setFade(1, 0);
  const logo = logoOverlay('<div class="presents">פרודיה אוהבת על החיים בישראל</div>');
  await wait(60);
  logo.classList.add('show');
  game.audio.play('whoosh', undefined, 0.8, 0.6);
  await wait(3200);
  logo.classList.add('hide');
  await wait(900);
  logo.remove();
  const shots: Shot[] = [
    { duration: 7, move: 'dolly', from: [-420, 55, 240], to: [-330, 45, 60], look: [-200, 10, 0], lookTo: [-150, 5, -40], hour: 17.4, transition: 'fade', title: { text: 'תל אביב', sub: 'העיר שלא ישנה (כי יש פקק)' } },
    { duration: 6, move: 'crane', from: [-140, 30, 60], to: [-40, 45, -30], look: [-73, 2, 0], lookTo: [-60, 0, -40], height: 15, title: { text: 'השוק', sub: '"רק בשבילך, מותק"' } },
    { duration: 6, move: 'dolly', from: [60, 22, -220], to: [70, 18, 40], look: [105, 0, -100], lookTo: [105, 0, 120], title: { text: 'איילון', sub: '12 נתיבים של סבלנות' } },
    { duration: 7, move: 'orbit', look: [590, 16, 0], radius: 170, height: 70, angleFrom: -1.2, angleTo: -0.4, title: { text: 'ירושלים', sub: 'שעת שקיעה זהובה' } },
    { duration: 5, move: 'dolly', from: [-200, 6, 40], to: [-203, 2.4, 28], look: [-206, 1.5, 22], transition: 'fade', title: { text: 'אבי', sub: 'בחור רגיל. יום לא רגיל.' } },
  ];
  await cs.play(shots);
}

/** Ending: back to the logo + slogan + credits. */
export async function playEnding(game: Game) {
  gameStore.setState({ phase: 'ending' });
  game.cutscene.setFade(1, 1200);
  await wait(1400);
  const credits = `<div class="slogan">זמין כל הזמן<br>בכל מקום</div>
    <div class="credits">
      <p>תודה ששיחקתם ב-GTA VI: Israel</p>
      <p>פרויקט מעריצים לא רשמי · סאטירה באהבה</p>
      <p>נכסים: Poly Haven · Quaternius (CC0)</p>
      <p>מנוע: Three.js · Rapier · Howler</p>
      <p class="small">אף פלאפל לא נפגע במהלך הפקת המשחק</p>
    </div><button class="continue">המשך לשחק בעולם הפתוח</button>`;
  const el = logoOverlay(credits);
  el.classList.add('ending');
  await wait(60);
  el.classList.add('show');
  await new Promise<void>((resolve) => el.querySelector('.continue')!.addEventListener('click', () => resolve()));
  el.classList.add('hide');
  game.cutscene.setFade(0, 800);
  await wait(800);
  el.remove();
  gameStore.setState({ phase: 'playing' });
}
