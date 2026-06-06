let nextId = 0

function pastelColour() {
  const hue = Math.random() * 360
  return `hsl(${hue}, 50%, 90%)`
}

// Darken or lighten an HSL colour string by `percent` lightness units
function shadeColour(hslStr, percent) {
  const match = hslStr.match(/hsl\(\s*(\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/)
  if (!match) return hslStr
  const [, h, s, l] = match
  const newL = Math.max(0, Math.min(100, parseFloat(l) + percent))
  return `hsl(${h}, ${s}%, ${newL}%)`
}

// Draw a single cloud blob with a radial gradient for a 3D lit look
function drawCloudBlob(ctx, bx, by, br, colour) {
  const gradient = ctx.createRadialGradient(
    bx - br * 0.3, by - br * 0.35, br * 0.05,  // highlight (top-left)
    bx, by, br                                   // outer edge
  )
  gradient.addColorStop(0,   'rgba(255, 255, 255, 0.98)')
  gradient.addColorStop(0.5, colour)
  gradient.addColorStop(1,   shadeColour(colour, -10))

  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.fill()
}

// Wide cloud silhouette: flat-ish base, 3 bumpy humps on top
function getCloudBlobs(cx, cy, r) {
  return [
    // Bottom row — flat base
    { x: cx - r * 0.85, y: cy + r * 0.25, r: r * 0.62 },
    { x: cx,            y: cy + r * 0.28, r: r * 0.68 },
    { x: cx + r * 0.85, y: cy + r * 0.25, r: r * 0.62 },
    // Top row — bumps
    { x: cx - r * 0.72, y: cy - r * 0.12, r: r * 0.58 },
    { x: cx,            y: cy - r * 0.32, r: r * 0.72 }, // tallest centre bump
    { x: cx + r * 0.68, y: cy - r * 0.08, r: r * 0.54 },
  ]
}

function sizeConfig() {
  const r = Math.random()
  if (r < 0.25) {
    return { radius: 28 + Math.random() * 10, points: 2 }
  } else if (r < 0.75) {
    return { radius: 45 + Math.random() * 15, points: 1 }
  } else {
    return { radius: 65 + Math.random() * 15, points: 1 }
  }
}

export function makeCloud(canvasWidth, canvasHeight, spreadX = true, topMargin = 0, bottomMargin = 0) {
  const { radius, points } = sizeConfig()
  const x = spreadX
    ? radius + Math.random() * (canvasWidth - radius * 2)
    : canvasWidth + radius
  const minY   = topMargin + radius
  const maxY   = canvasHeight - bottomMargin - radius
  const baseY  = minY + Math.random() * Math.max(0, maxY - minY)
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

export function spawnCloud(canvasWidth, canvasHeight, topMargin = 0, bottomMargin = 0) {
  return makeCloud(canvasWidth, canvasHeight, true, topMargin, bottomMargin)
}

function drawCloud(ctx, cloud) {
  const { x, y, radius, colour } = cloud
  const blobs = getCloudBlobs(x, y, radius)

  // Drop shadow on bottom row to ground the cloud
  ctx.shadowColor   = 'rgba(100, 120, 160, 0.25)'
  ctx.shadowBlur    = 16
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 5

  // Bottom row first (flat base, indices 0–2)
  blobs.slice(0, 3).forEach(b => drawCloudBlob(ctx, b.x, b.y, b.r, colour))

  // Reset shadow so top bumps don't double-shadow
  ctx.shadowColor   = 'transparent'
  ctx.shadowBlur    = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  // Top bumps on top (indices 3–5)
  blobs.slice(3).forEach(b => drawCloudBlob(ctx, b.x, b.y, b.r, colour))

  // Subtle anchor shadow at the base
  const anchorGrad = ctx.createRadialGradient(
    x, y + radius * 0.5, radius * 0.1,
    x, y + radius * 0.5, radius * 1.0
  )
  anchorGrad.addColorStop(0, 'rgba(80, 100, 160, 0.10)')
  anchorGrad.addColorStop(1, 'rgba(80, 100, 160, 0.0)')

  ctx.beginPath()
  ctx.ellipse(x, y + radius * 0.45, radius * 1.05, radius * 0.38, 0, 0, Math.PI)
  ctx.fillStyle = anchorGrad
  ctx.fill()
}

export function updateClouds(clouds, dt, time, canvasWidth, canvasHeight, speedMult = 1, topMargin = 0, bottomMargin = 0) {
  for (const c of clouds) {
    if (c.state === 'alive') {
      c.x += c.baseVx * speedMult
      if (c.x - c.radius > canvasWidth) c.x = -c.radius
      const bobbedY = c.baseY + Math.sin(time * 0.8 + c.id) * 8
      c.y = Math.max(topMargin + c.radius,
             Math.min(canvasHeight - bottomMargin - c.radius, bobbedY))
    } else if (c.state === 'poofing' || c.state === 'exploding') {
      c.animProgress += dt / 400
      if (c.animProgress >= 1) c.state = 'dead'
    }

    c.particles.forEach(p => {
      p.x += p.vx
      p.y += p.vy
      p.vy += p.gravity ?? 0.3
      p.alpha -= 0.022
    })
    c.particles = c.particles.filter(p => p.alpha > 0)
  }
  return clouds.filter(c => c.state !== 'dead' || c.particles.length > 0)
}

export function drawClouds(ctx, clouds) {
  for (const c of clouds) {
    if (c.state === 'alive') {
      ctx.globalAlpha = 1
      drawCloud(ctx, c)
    } else if (c.state === 'poofing') {
      const scale = 1 - c.animProgress * 0.6
      const alpha = 1 - c.animProgress
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(c.x, c.y)
      ctx.scale(scale, scale)
      ctx.translate(-c.x, -c.y)
      drawCloud(ctx, c)
      ctx.restore()
    }

    // Ensure shadow is always reset after any cloud draw path
    ctx.shadowColor   = 'transparent'
    ctx.shadowBlur    = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0

    ctx.globalAlpha = 1
    c.particles.forEach(p => {
      ctx.save()
      ctx.globalAlpha = p.alpha

      if (p.type === 'pill') {
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        const w = p.width, h = p.height, r = h / 2
        ctx.beginPath()
        ctx.moveTo(-w / 2 + r, -h / 2)
        ctx.lineTo(w / 2 - r, -h / 2)
        ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r)
        ctx.lineTo(w / 2 - r, h / 2)
        ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r)
        ctx.closePath()
        ctx.fillStyle = p.colour
        ctx.fill()
        ctx.strokeStyle = p.strokeColour
        ctx.lineWidth = p.strokeWidth
        ctx.stroke()

      } else if (p.type === 'sparkle') {
        ctx.translate(p.x, p.y)
        const s = p.size, inner = s * 0.4
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2
          const rad = i % 2 === 0 ? s : inner
          i === 0
            ? ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad)
            : ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
        }
        ctx.closePath()
        ctx.fillStyle = p.colour
        ctx.fill()

      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius ?? 6, 0, Math.PI * 2)
        ctx.fillStyle = p.colour ?? 'white'
        ctx.fill()
      }

      ctx.restore()
    })
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

  const pillCount = 9
  for (let i = 0; i < pillCount; i++) {
    const baseAngle = (i / pillCount) * Math.PI * 2
    const spread = (Math.random() - 0.5) * 0.5
    const angle = baseAngle + spread
    const speed = 4 + Math.random() * 5
    cloud.particles.push({
      type: 'pill',
      x: cloud.x, y: cloud.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: angle + (Math.random() - 0.5) * 0.8,
      width: 18 + Math.random() * 18,
      height: 8 + Math.random() * 5,
      alpha: 1,
      gravity: 0.28,
      colour: '#FF2D2D',
      strokeColour: '#FFE600',
      strokeWidth: 4,
    })
  }

  const sparkleCount = 2 + Math.floor(Math.random() * 2)
  for (let i = 0; i < sparkleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 2 + Math.random() * 2
    cloud.particles.push({
      type: 'sparkle',
      x: cloud.x + (Math.random() - 0.5) * cloud.radius,
      y: cloud.y + (Math.random() - 0.5) * cloud.radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      size: 10 + Math.random() * 8,
      colour: i % 2 === 0 ? '#FFFFFF' : '#FFE600',
      gravity: 0.1,
    })
  }
}

export function hitTest(cloud, px, py) {
  if (cloud.state !== 'alive') return false
  const dx = cloud.x - px
  const dy = cloud.y - py
  return Math.sqrt(dx * dx + dy * dy) < cloud.radius * 1.5
}
