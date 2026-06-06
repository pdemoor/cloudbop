import { getTrophyCount } from './utils.js'

export function drawScore(ctx, score, highScore, canvasWidth) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 4
  ctx.textAlign = 'right'
  ctx.fillStyle = 'white'

  ctx.font = 'bold 1.4rem system-ui'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`Score: ${score}`, canvasWidth - 20, 36)

  ctx.font = '1rem system-ui'
  ctx.fillText(`Best: ${highScore}`, canvasWidth - 20, 58)

  const trophyCount = getTrophyCount(score)
  if (trophyCount > 0) {
    const trophies = '🏆'.repeat(trophyCount)
    ctx.font = '1.2rem system-ui'
    ctx.fillText(trophies, canvasWidth - 20, 82)
  }
  ctx.restore()
}

export function drawFloatingLabels(ctx, labels, now) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const l of labels) {
    const elapsed = now - l.startTime
    const t = Math.min(elapsed / l.duration, 1)
    const alpha = 1 - t
    if (alpha <= 0) continue
    const y = l.y - t * 60
    ctx.globalAlpha = alpha
    ctx.font = `bold ${l.fontSize} system-ui`
    ctx.fillStyle = l.colour
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 4
    ctx.fillText(l.text, l.x, y)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}
