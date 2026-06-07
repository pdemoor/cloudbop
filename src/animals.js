const FLYING_EMOJIS = ['🦋','🦜','🦅','🦆','🐦','🦉','🦚','🦩','🦇']
const RARE_EMOJIS   = ['🐉','🦄','🧚']
const FEATHER_EMOJI = '🪶'
const SIZE = 48
let nextAnimalId = 0

function rand(min, max) { return min + Math.random() * (max - min) }

export function spawnAnimal(canvasWidth, canvasHeight, topMargin = 0, bottomMargin = 0) {
  const roll = Math.random()

  // 10% feather, 20% rare, 70% normal flying
  if (roll < 0.10) {
    // Feather — falls top to bottom
    return {
      id: nextAnimalId++,
      emoji: FEATHER_EMOJI,
      type: 'feather',
      x: 20 + Math.random() * Math.max(0, canvasWidth - 40),
      y: topMargin,
      vx: (Math.random() - 0.5) * 0.6,
      vy: 0.8 + Math.random() * 0.6,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 1.5 + Math.random() * 1.0,
      swayAmp: 1.2,
      size: 40 + Math.random() * 10,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.04,
      alive: true,
      rare: false,
      points: 1,
      particles: [],
      flapPhase: 0,
      flapSpeed: 0,
      done: false,
    }
  }

  const isRare = roll < 0.30  // next 20% are rare (0.10–0.30)
  const pool   = isRare ? RARE_EMOJIS : FLYING_EMOJIS
  const fromLeft = Math.random() < 0.5
  const minY = topMargin + 30
  const maxY = canvasHeight - bottomMargin - 30
  const y    = minY + Math.random() * Math.max(0, maxY - minY)
  const duration = rand(4000, 6000)

  return {
    id: nextAnimalId++,
    emoji: pool[Math.floor(Math.random() * pool.length)],
    type: isRare ? 'rare' : 'normal',
    x: fromLeft ? -SIZE : canvasWidth + SIZE,
    y,
    vx: fromLeft
      ? canvasWidth / (duration / 16)
      : -(canvasWidth / (duration / 16)),
    size: SIZE,
    alive: true,
    rare: isRare,
    points: isRare ? 3 : 1,
    particles: [],
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 3 + Math.random() * 2,
    done: false,
  }
}

export function updateAnimals(animals, canvasWidth, canvasHeight = 800, bottomMargin = 0, delta = 1) {
  for (const a of animals) {
    if (!a.alive) {
      // just update particles
    } else if (a.type === 'feather') {
      a.swayPhase += a.swaySpeed * (1 / 60) * delta
      a.x        += (a.vx + Math.sin(a.swayPhase) * a.swayAmp) * delta
      a.y        += a.vy * delta
      a.rotation += a.rotationSpeed * delta
      if (a.y > canvasHeight - bottomMargin + 40) {
        a.done = true
        a.alive = false
      }
    } else {
      a.flapPhase += a.flapSpeed * (1 / 60) * delta
      a.x         += a.vx * delta
    }

    for (const p of a.particles) {
      p.x += p.vx
      p.y += p.vy
      p.alpha -= 0.03
    }
    a.particles = a.particles.filter(p => p.alpha > 0)
  }

  return animals.filter(a => {
    if (a.done)    return a.particles.length > 0
    if (!a.alive)  return a.particles.length > 0
    if (a.type === 'feather') return true  // feather removal handled above via done
    return a.x > -a.size * 2 && a.x < canvasWidth + a.size * 2
  })
}

function drawAnimal(ctx, animal) {
  ctx.save()

  // Reset ALL state that could leak from weather/cloud drawing
  ctx.globalAlpha = 1.0
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  ctx.translate(animal.x, animal.y)

  if (animal.type === 'feather') {
    ctx.rotate(animal.rotation || 0)

    // Soft white background circle so feather pops against sky
    ctx.beginPath()
    ctx.arc(0, 0, (animal.size || 36) * 0.7, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.50)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 2.5
    ctx.stroke()

    ctx.font = `${animal.size || 36}px serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(FEATHER_EMOJI, 0, 0)

  } else if (animal.type === 'pig') {
    const flapScale = 0.80 + 0.20 * Math.abs(Math.sin(animal.flapPhase || 0))
    if (animal.vx < 0) ctx.scale(-1, 1)
    ctx.scale(1, flapScale)

    // Pink background circle for the pig
    ctx.beginPath()
    ctx.arc(0, 0, (animal.size || 52) * 0.72, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 182, 193, 0.70)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 2.5
    ctx.stroke()

    ctx.font = `${animal.size || 52}px serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText('🐷', 0, 0)

  } else {
    // Normal and rare flying animals
    const flapScale = 0.78 + 0.22 * Math.abs(Math.sin(animal.flapPhase || 0))
    if (animal.vx < 0) ctx.scale(-1, 1)
    ctx.scale(1, flapScale)

    // Soft white background circle so emoji pops against sky
    ctx.beginPath()
    ctx.arc(0, 0, (animal.size || 44) * 0.65, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 2.5
    ctx.stroke()

    ctx.font = `${animal.size || 44}px serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(animal.emoji, 0, 0)
  }

  ctx.restore()
}

export function drawAnimals(ctx, animals) {
  for (const a of animals) {
    if (a.alive) {
      drawAnimal(ctx, a)
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
  const count = animal.rare ? 12 : 6
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
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
