/**
 * Entry point.
 *
 * Portrait-locked, FIT-scaled, pixel-perfect. The logical canvas is fixed at 540 × 1170 so every
 * layout constant in `game/layout.ts` means the same thing on every device, and the scaler deals
 * with the rest.
 */
import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, PALETTE } from './game/layout.ts';
import { BootScene } from './game/scenes/BootScene.ts';
import { TitleScene } from './game/scenes/TitleScene.ts';
import { WorldScene } from './game/scenes/WorldScene.ts';
import { BattleOverlay } from './game/scenes/BattleOverlay.ts';
import { DialogueScene } from './game/scenes/DialogueScene.ts';
import { MenuScene } from './game/scenes/MenuScene.ts';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  backgroundColor: PALETTE.deckDarkEdge,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 3, // stick + action + a spare, so multi-touch never drops an input
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, TitleScene, WorldScene, BattleOverlay, DialogueScene, MenuScene],
};

const game = new Phaser.Game(config);

// Hide the HTML boot card once Phaser has painted its first frame.
game.events.once(Phaser.Core.Events.READY, () => {
  const boot = document.getElementById('boot');
  if (boot) {
    boot.setAttribute('hidden', '');
    window.setTimeout(() => boot.remove(), 500);
  }
});

// Exposed for the Playwright smoke harness, which drives the real build rather than a mock.
declare global {
  interface Window {
    __SOJUTSU__?: Phaser.Game;
  }
}
window.__SOJUTSU__ = game;
