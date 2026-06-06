import { Howl, Howler } from 'howler';

function makeSound(src, volumeBase = 1.0) {
  return new Howl({
    src: [src],
    volume: volumeBase,
    preload: true,
  });
}

const sounds = {
  poof:         makeSound('/sounds/poof-soft.wav',    0.7),
  explode:      makeSound('/sounds/explode.wav',       0.8),
  combo3:       makeSound('/sounds/combo-3.wav',       0.8),
  combo5:       makeSound('/sounds/combo-5.wav',       0.9),
  animalNorm:   makeSound('/sounds/animal-normal.wav', 0.8),
  animalRare:   makeSound('/sounds/animal-rare.wav',   0.9),
  timerStart:   makeSound('/sounds/timer-start.wav',   0.8),
  timerTick:    makeSound('/sounds/timer-tick.wav',    0.6),
  timerWinEnd:  makeSound('/sounds/timer-end-win.wav', 0.9),
  timerLoseEnd: makeSound('/sounds/timer-end-lose.wav',0.9),
  trophy:       makeSound('/sounds/trophy.wav',        1.0),
};

let muted = false;

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  Howler.mute(muted);
  return muted;
}

// Play with random pitch variation ±8%
export function play(name) {
  if (muted) return;
  const s = sounds[name];
  if (!s) return;
  const rate = 0.92 + Math.random() * 0.16;
  s.rate(rate);
  s.play();
}
