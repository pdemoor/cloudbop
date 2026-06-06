export function drawScore(ctx, score, canvasWidth) {
  ctx.save()
  ctx.font = 'bold 1.4rem system-ui'
  ctx.fillStyle = 'white'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 4
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`Score: ${score}`, canvasWidth - 20, 36)

  const trophyCount = Math.floor(score / 100)
  if (trophyCount > 0) {
    const trophies = '🏆'.repeat(Math.min(trophyCount, 5))
    ctx.font = '1.2rem system-ui'
    ctx.fillText(trophies, canvasWidth - 20, 64)
  }
  ctx.restore()
}
