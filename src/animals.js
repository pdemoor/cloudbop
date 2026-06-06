const POOL = ['🦋','🦜','🦅','🦆','🐦','🦉','🦚','🦩','🐉','🦄','🧚','🦇','🪶']
const SIZE = 44
let nextAnimalId = 0

function rand(min, max) { return min + Math.random() * (max - min) }

export function spawnAnimal(canvasWidth, canvasHeight) {
  const fromLeft = Math.random() < 0.5
  const y = rand(canvasHeight * 0.05, canvasHeight * 0.6)
  const duration = rand(4000, 6000)
  return {
    id: nextAnimalId++,
    emoji: POOL[Math.floor(Math.random() * POOL.length)],
    x: fromLeft ? -SIZE : canvasWidth + SIZE,
    y,
    vx: fromLeft ? canvasWidth / (duration / 16) : -(canvasWidth / (duration / 16)),
    size: SIZE,
    alive: true,
    particles: [],
  }
}

export function updateAnimals(animals, canvasWidth) {
  for (const a of animals) {
    if (a.alive) {
      a.x += a.vx
    }
    for (const p of a.particles) {
      p.x += p.vx
      p.y += p.vy
      p.alpha -= 0.03
    }
    a.particles = a.particles.filter(p => p.alpha > 0)
  }
  return animals.filter(a => {
    if (!a.alive) return a.particles.length > 0
    return a.x > -a.size * 2 && a.x < canvasWidth + a.size * 2
  })
}

export function drawAnimals(ctx, animals) {
  for (const a of animals) {
    if (a.alive) {
      ctx.save()
      ctx.font = `${a.size}px serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      if (a.vx < 0) {
        ctx.scale(-1, 1)
        ctx.fillText(a.emoji, -a.x, a.y)
      } else {
        ctx.fillText(a.emoji, a.x, a.y)
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
    for (const p of a.particles) {
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.colour
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

export function hitTestAnimal(animal, px, py) {
  if (!animal.alive) return false
  const dx = animal.x - px
  const dy = animal.y - py
  return Math.sqrt(dx * dx + dy * dy) < animal.size * 0.8
}

export function bopAnimal(animal) {
  animal.alive = false
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const speed = 2 + Math.random() * 4
    animal.particles.push({
      x: animal.x, y: animal.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      radius: 5 + Math.random() * 4,
      colour: '#FFD700',
    })
  }
}
