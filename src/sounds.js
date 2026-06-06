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

// ── Thunder — Web Audio API, fresh context per strike ────────────────────────

function createThunder(intensity) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const actx = new AudioContext()
    const duration = intensity === 'close' ? 1.8 : 1.2
    const bufferSize = Math.floor(actx.sampleRate * duration)
    const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate)
    const data = buffer.getChannelData(0)

    for (let i = 0; i < bufferSize; i++) {
      const t = i / actx.sampleRate
      const envelope = intensity === 'close'
        ? Math.exp(-t * 2.5)
        : Math.exp(-t * 4.0)
      data[i] = (Math.random() * 2 - 1) * envelope *
        (intensity === 'close' ? 0.9 : 0.5)
    }

    const source = actx.createBufferSource()
    source.buffer = buffer

    const filter = actx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = intensity === 'close' ? 180 : 120

    const gain = actx.createGain()
    gain.gain.value = muted ? 0 : 0.85

    source.connect(filter)
    filter.connect(gain)
    gain.connect(actx.destination)
    source.start()

    setTimeout(() => actx.close(), (duration + 0.5) * 1000)
  } catch (e) {
    console.warn('Thunder audio error:', e)
  }
}

export function playThunder(combo) {
  if (muted) return
  createThunder(combo >= 100 ? 'close' : 'distant')
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
