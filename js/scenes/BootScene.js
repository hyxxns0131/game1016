import { buildFxTextures } from '../render.js';

const IMG = 'assets/img/';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  init(data) { this.onReady = data.onReady; }

  preload() {
    ['prisoner', 'guard', 'zombie', 'brute', 'key'].forEach((k) => this.load.image(k, `${IMG}${k}.png`));
    ['floor', 'grass'].forEach((k) => this.load.image(k, `${IMG}${k}.jpg`));
    ['endA1', 'endA2', 'endA2_alt', 'endA3', 'endA4', 'endB1', 'endB2', 'endB3', 'endB3_alt', 'endB4',
      'loseP1', 'loseP1_alt', 'loseP2', 'loseP3', 'loseG1', 'loseG1_alt', 'loseG2', 'loseG3']
      .forEach((k) => this.load.image(k, `${IMG}${k}.jpg`));
  }

  create() {
    buildFxTextures(this);
    this.onReady?.();
  }
}
