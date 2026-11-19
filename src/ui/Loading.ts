import tips from '../data/tips.json';

/** Title/loading screen with rotating satirical tips. */
export class LoadingScreen {
  private el = document.getElementById('loading')!;
  private fill = document.getElementById('loading-fill')!;
  private tip = document.getElementById('loading-tip')!;
  private btn = document.getElementById('start-btn') as HTMLButtonElement;
  private tipTimer: number;
  private tipIdx = Math.floor(Math.random() * tips.length);

  constructor() {
    this.showTip();
    this.tipTimer = window.setInterval(() => this.showTip(), 3500);
  }

  private showTip() {
    this.tip.textContent = tips[this.tipIdx % tips.length];
    this.tipIdx++;
  }

  progress(p: number, label?: string): void {
    this.fill.style.width = `${Math.round(p * 100)}%`;
    if (label) this.fill.title = label;
  }

  /** Show the start button; resolves when the player starts. */
  waitForStart(): Promise<void> {
    this.btn.hidden = false;
    return new Promise((resolve) => {
      const go = () => {
        window.removeEventListener('keydown', go);
        this.btn.removeEventListener('click', go);
        window.clearInterval(this.tipTimer);
        this.el.classList.add('fade');
        setTimeout(() => (this.el.hidden = true), 900);
        resolve();
      };
      this.btn.addEventListener('click', go);
      window.addEventListener('keydown', go);
    });
  }
}
