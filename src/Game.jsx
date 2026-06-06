import { useRef, useEffect, useState, useCallback } from 'react'
import { useGameLoop } from './useGameLoop.js'
import {
  makeCloud, spawnCloud, updateClouds, drawClouds,
  poofCloud, explodeCloud, hitTest,
} from './clouds.js'
import {
  spawnAnimal, updateAnimals, drawAnimals,
  hitTestAnimal, bopAnimal,
} from './animals.js'
import { drawScore, drawFloatingLabels } from './scorer.js'

const ANIMAL_INTERVAL_START = 10000
const ANIMAL_INTERVAL_MIN   = 5000
const COMBO_WINDOW = 1500  // ms between taps to keep combo

function makeLabel(x, y, text, colour, fontSize, duration) {
  return { x, y, text, colour, fontSize, duration, startTime: performance.now() }
}

export default function Game() {
  const canvasRef = useRef(null)

  // React state — only what drives HTML elements
  const [showShare, setShowShare]       = useState(false)
  const [shareScore, setShareScore]     = useState(0)
  const [shareCopied, setShareCopied]   = useState(false)
  const [showNudge, setShowNudge]       = useState(false)

  const stateRef = useRef({
    clouds: [],
    animals: [],
    score: 0,
    highScore: parseInt(localStorage.getItem('cloudbop_high') || '0'),
    lastAnimalSpawn: 0,
    pointer: null,

    // combo
    comboCount: 0,
    lastTapTime: 0,

    // speed ramp
    speedMult: 1,
    animalInterval: ANIMAL_INTERVAL_START,
    lastRampThreshold: 0,

    // floating labels
    floatingLabels: [],

    // screen shake
    shakeFrames: 0,

    // trophy flash
    trophyFlash: null,      // { startTime, duration }
    lastTrophyThreshold: 0,

    // rare glow
    rareGlow: null,         // { startTime, duration }

    // share button auto-hide timer
    shareHideTimer: null,
  })

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    resizeCanvas()
    const w = window.innerWidth
    const h = window.innerHeight
    const s = stateRef.current
    for (let i = 0; i < 5; i++) s.clouds.push(makeCloud(w, h, true))

    const onResize = () => resizeCanvas()
    window.addEventListener('resize', onResize)

    // iOS nudge — 30 seconds, once
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    const nudgeDismissed = localStorage.getItem('cloudbop_nudge_dismissed') === '1'
    let nudgeTimer
    if (!isStandalone && !nudgeDismissed) {
      nudgeTimer = setTimeout(() => setShowNudge(true), 30000)
    }

    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(nudgeTimer)
    }
  }, [])

  function resizeCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function checkRamp(s) {
    const tier = Math.floor(s.score / 50)
    if (tier > s.lastRampThreshold) {
      s.lastRampThreshold = tier
      s.speedMult        = Math.min(2.5, 1 + tier * 0.1)
      s.animalInterval   = Math.max(ANIMAL_INTERVAL_MIN, ANIMAL_INTERVAL_START - tier * 1000)
    }
  }

  function checkTrophy(s, now) {
    const threshold = Math.floor(s.score / 100) * 100
    if (threshold > 0 && threshold > s.lastTrophyThreshold) {
      s.lastTrophyThreshold = threshold
      s.trophyFlash = { startTime: now, duration: 800 }

      // Show share button for 5s
      setShareScore(s.score)
      setShowShare(true)
      if (s.shareHideTimer) clearTimeout(s.shareHideTimer)
      s.shareHideTimer = setTimeout(() => setShowShare(false), 5000)
    }
  }

  // ── Pointer handlers ──────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    stateRef.current.pointer = { x, y, downX: x, downY: y }
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!stateRef.current.pointer) return
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    stateRef.current.pointer.x = e.clientX - rect.left
    stateRef.current.pointer.y = e.clientY - rect.top
  }, [])

  const onPointerUp = useCallback((e) => {
    const s = stateRef.current
    if (!s.pointer) return
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const upX = e.clientX - rect.left
    const upY = e.clientY - rect.top
    const dx  = upX - s.pointer.downX
    const dy  = upY - s.pointer.downY
    const velocity = Math.sqrt(dx * dx + dy * dy)
    const tx = s.pointer.downX
    const ty = s.pointer.downY
    const now = performance.now()

    let hit = false

    // Animals first
    for (const a of s.animals) {
      if (hitTestAnimal(a, tx, ty)) {
        bopAnimal(a)
        s.score += a.points
        hit = true

        if (a.rare) {
          s.floatingLabels.push(makeLabel(tx, ty, '+3 ✨', '#FFD700', '1.6rem', 800))
          s.rareGlow = { startTime: now, duration: 300 }
        } else {
          s.floatingLabels.push(makeLabel(tx, ty, '+1', 'white', '1.2rem', 600))
        }
        break
      }
    }

    // Clouds
    if (!hit) {
      for (const c of s.clouds) {
        if (hitTest(c, tx, ty)) {
          if (velocity < 12) {
            poofCloud(c)
          } else {
            explodeCloud(c)
            s.shakeFrames = 3
          }
          s.score += c.points

          // Point label
          const label = c.points === 2 ? '+2' : '+1'
          s.floatingLabels.push(makeLabel(tx, ty + 20, label, 'white', '1.2rem', 600))

          // Combo
          if (now - s.lastTapTime < COMBO_WINDOW) {
            s.comboCount++
          } else {
            s.comboCount = 1
          }
          s.lastTapTime = now

          if (s.comboCount >= 3) {
            const bonus = s.comboCount
            s.score += bonus
            s.floatingLabels.push(
              makeLabel(tx, ty - 30, `COMBO x${s.comboCount}!`, '#FFE600', '1.6rem', 800)
            )
          }

          hit = true
          break
        }
      }
    }

    // Update high score
    if (s.score > s.highScore) {
      s.highScore = s.score
      localStorage.setItem('cloudbop_high', s.highScore)
    }

    // Speed ramp & trophy check
    checkRamp(s)
    checkTrophy(s, now)

    s.pointer = null
  }, [])

  // ── Add cloud button ──────────────────────────────────────────────────────
  const addCloud = useCallback(() => {
    const s = stateRef.current
    s.clouds.push(spawnCloud(window.innerWidth, window.innerHeight))
  }, [])

  // ── Share handler ─────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    const s   = stateRef.current
    const score = s.score
    const trophyCount = Math.min(Math.floor(score / 100), 5)
    const text = `I scored ${score} on cloudbop.com! ${'🏆'.repeat(trophyCount)}`
    if (navigator.share) {
      navigator.share({ text, url: 'https://www.cloudbop.com' })
        .then(() => setShowShare(false))
        .catch(() => {})
    } else {
      navigator.clipboard.writeText(`${text} https://www.cloudbop.com`)
      setShareCopied(true)
      setTimeout(() => {
        setShareCopied(false)
        setShowShare(false)
      }, 1500)
    }
    if (s.shareHideTimer) clearTimeout(s.shareHideTimer)
  }, [])

  // ── Dismiss nudge ─────────────────────────────────────────────────────────
  const dismissNudge = useCallback(() => {
    setShowNudge(false)
    localStorage.setItem('cloudbop_nudge_dismissed', '1')
  }, [])

  // ── Game loop ─────────────────────────────────────────────────────────────
  useGameLoop((dt, now) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    const s = stateRef.current

    // Spawn animal
    if (now - s.lastAnimalSpawn > s.animalInterval) {
      s.animals.push(spawnAnimal(w, h))
      s.lastAnimalSpawn = now
    }

    // Update
    s.clouds = updateClouds(s.clouds, dt, now / 1000, w, h, s.speedMult)
    s.animals = updateAnimals(s.animals, w)
    s.floatingLabels = s.floatingLabels.filter(l => now - l.startTime < l.duration)

    // ── Draw ──────────────────────────────────────────────────────────────

    // Screen shake
    ctx.save()
    if (s.shakeFrames > 0) {
      const sx = (Math.random() - 0.5) * 12
      const sy = (Math.random() - 0.5) * 12
      ctx.translate(sx, sy)
      s.shakeFrames--
    }

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#1AADDF')
    grad.addColorStop(1, '#87CEEB')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    drawClouds(ctx, s.clouds)
    drawAnimals(ctx, s.animals)
    drawScore(ctx, s.score, s.highScore, w)
    drawFloatingLabels(ctx, s.floatingLabels, now)

    // Trophy flash overlay
    if (s.trophyFlash) {
      const elapsed = now - s.trophyFlash.startTime
      const t = elapsed / s.trophyFlash.duration
      if (t < 1) {
        const alpha = 0.25 * (1 - t)
        ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`
        ctx.fillRect(0, 0, w, h)

        // Centred trophy text
        const textAlpha = Math.max(0, 1 - t * (s.trophyFlash.duration / 800))
        ctx.globalAlpha = textAlpha
        ctx.font = 'bold 2rem system-ui'
        ctx.fillStyle = '#FFD700'
        ctx.shadowColor = 'rgba(0,0,0,0.8)'
        ctx.shadowBlur = 6
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🏆 TROPHY!', w / 2, h / 2)
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      } else {
        s.trophyFlash = null
      }
    }

    // Rare glow border
    if (s.rareGlow) {
      const elapsed = now - s.rareGlow.startTime
      const t = elapsed / s.rareGlow.duration
      if (t < 1) {
        const alpha = 0.3 * (1 - t)
        ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`
        ctx.lineWidth = 20
        ctx.strokeRect(0, 0, w, h)
      } else {
        s.rareGlow = null
      }
    }

    ctx.restore() // end shake transform
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <button className="add-cloud-btn" onClick={addCloud}>
        ☁️ Add
      </button>

      {showShare && (
        <button
          className="share-btn"
          onClick={handleShare}
        >
          {shareCopied ? 'Copied! ✓' : 'Share my score 🏆'}
        </button>
      )}

      {showNudge && (
        <div className="nudge-bar">
          <span className="nudge-text">
            ☁️ <strong>Add Cloudpop to your home screen</strong><br />
            <span className="nudge-sub">Tap Share then "Add to Home Screen"</span>
          </span>
          <button className="nudge-dismiss" onClick={dismissNudge}>✕</button>
        </div>
      )}
    </>
  )
}
