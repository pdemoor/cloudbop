let nextId = 0

function pastelColour() {
  const hue = Math.random() * 360
  return `hsl(${hue}, 50%, 90%)`
}

function sizeConfig() {
  const r = Math.random()
  if (r < 0.25) {
    // Small
    return { radius: 28 + Math.random() * 10, points: 2 }
  } else if (r < 0.75) {
    // Medium
    return { radius: 45 + Math.random() * 15, points: 1 }
  } else {
    // Large
    return { radius: 65 + Math.random() * 15, points: 1 }
  }
}

export function makeCloud(canvasWidth, canvasHeight, spreadX = true) {
  const { radius, points } = sizeConfig()
  const x = spreadX
    ? radius + Math.random() * (canvasWidth - radius * 2)
    : canvasWidth + radius
  const baseY = radius + Math.random() * (canvasHeight * 0.55 - radius)
  const baseVx = 0.2 + Math.random() * 0.3
  return {
    id: nextId++,
    x,
    y: baseY,
    baseY,
    vx: baseVx,
    baseVx,
    colour: pastelColour(),
    radius,
    points,
    state: 'alive',
    animProgress: 0,
    particles: [],
  }
}

export function spawnCloud(canvasWidth, canvasHeight) {
  return makeCloud(canvasWidth, canvasHeight, true)
}

function drawCloudShape(ctx, cloud) {
  const { x, y, radius, colour } = cloud
  ctx.fillStyle = colour
  const blobs = [
    { dx: 0,              dy: 0,              r: radius },
    { dx: -radius * 0.55, dy: radius * 0.15,  r: radius * 0.72 },
    { dx:  radius * 0.55, dy: radius * 0.15,  r: radius * 0.72 },
    { dx: -radius * 0.25, dy: -radius * 0.45, r: radius * 0.65 },
    { dx:  radius * 0.3,  dy: -radius * 0.35, r: radius * 0.6  },
  ]
  blobs.forEach(b => {
    ctx.beginPath()
    ctx.arc(x + b.dx, y + b.dy, b.r, 0, Math.PI * 2)
    ctx.fill()
  })
}

export function updateClouds(clouds, dt, time, canvasWidth, canvasHeight, speedMult = 1) {
  for (const c of clouds) {
    if (c.state === 'alive') {
      c.x += c.baseVx * speedMult
      if (c.x - c.radius > canvasWidth) c.x = -c.radius
      c.y = c.baseY + Math.sin(time * 0.8 + c.id) * 8
    } else if (c.state === 'poofing' || c.state === 'exploding') {
      c.animProgress += dt / 400
      if (c.animProgress >= 1) c.state = 'dead'
    }

    for (const p of c.particles) {
      p.x += p.vx
      p.y += p.vy
      if (c.state === 'exploding') p.vy += 0.3
      p.alpha -= 0.025
    }
    c.particles = c.particles.filter(p => p.alpha > 0)
  }
  return clouds.filter(c => c.state !== 'dead' || c.particles.length > 0)
}

export function drawClouds(ctx, clouds) {
  for (const c of clouds) {
    if (c.state === 'alive') {
      ctx.globalAlpha = 1
      drawCloudShape(ctx, c)
    } else if (c.state === 'poofing') {
      const scale = 1 - c.animProgress * 0.6
      const alpha = 1 - c.animProgress
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(c.x, c.y)
      ctx.scale(scale, scale)
      ctx.translate(-c.x, -c.y)
      drawCloudShape(ctx, c)
      ctx.restore()
    }

    ctx.globalAlpha = 1
    for (const p of c.particles) {
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.colour
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

function rand(min, max) { return min + Math.random() * (max - min) }

export function poofCloud(cloud) {
  cloud.state = 'poofing'
  cloud.animProgress = 0
  const count = 6 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const speed = rand(0.5, 2)
    cloud.particles.push({
      x: cloud.x, y: cloud.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      radius: rand(4, 8),
      colour: i % 2 === 0 ? 'white' : '#ccc',
    })
  }
}

export function explodeCloud(cloud) {
  cloud.state = 'exploding'
  cloud.animProgress = 0
  const count = 10 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand(-0.3, 0.3)
    const speed = rand(3, 8)
    cloud.particles.push({
      x: cloud.x, y: cloud.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      alpha: 1,
      radius: rand(6, 14),
      colour: cloud.colour,
    })
  }
}

export function hitTest(cloud, px, py) {
  if (cloud.state !== 'alive') return false
  const dx = cloud.x - px
  const dy = cloud.y - py
  return Math.sqrt(dx * dx + dy * dy) < cloud.radius * 1.3
}
