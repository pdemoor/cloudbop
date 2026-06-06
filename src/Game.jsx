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
import {
  submitDailyScore, getDailyBest,
  hasPlayedToday, markPlayedToday,
} from './supabase.js'
import { play, toggleMute } from './sounds.js'

const ANIMAL_INTERVAL_START = 10000
const ANIMAL_INTERVAL_MIN   = 5000
const COMBO_WINDOW          = 1500   // ms between taps to keep combo
const TIMER_DURATION        = 60000  // 1 minute in ms
const NUDGE_COOLDOWN        = 24 * 60 * 60 * 1000  // 24 hours

function makeLabel(x, y, text, colour, fontSize, duration) {
  return { x, y, text, colour, fontSize, duration, startTime: performance.now() }
}

export default function Game() {
  const canvasRef = useRef(null)

  // ── React state (drives HTML elements only) ───────────────────────────────
  const [showShare, setShowShare]                   = useState(false)
  const [shareCopied, setShareCopied]               = useState(false)
  const [showNudge, setShowNudge]                   = useState(false)
  const [showTimerBtn, setShowTimerBtn]             = useState(true)
  const [showResults, setShowResults]               = useState(false)
  const [resultScore, setResultScore]               = useState(0)
  const [resultShareCopied, setResultShareCopied]   = useState(false)
  const [dailyBest, setDailyBest]                   = useState(null)
  const [compPlayedToday, setCompPlayedToday]       = useState(false)
  const [muted, setMuted]                           = useState(false)

  // ── Game state ref (game-loop mutable, no re-renders) ─────────────────────
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
    trophyFlash: null,
    lastTrophyThreshold: 0,

    // rare glow
    rareGlow: null,

    // share button auto-hide timer
    shareHideTimer: null,
  })

  // ── Timer ref (game-loop readable, avoids stale React state) ─────────────
  const timerRef = useRef({
    active: false,
    ended: false,
    startTime: null,
    timeRemaining: 60,
    lastFlashSecond: Infinity,
    lastTickSecond: Infinity,
    flashAlpha: 0,
  })

  // Stable ref to endTimer callback so game loop can call it without closure staleness
  const endTimerCallbackRef = useRef(null)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    resizeCanvas()
    const w = window.innerWidth
    const h = window.innerHeight
    const s = stateRef.current
    for (let i = 0; i < 5; i++) s.clouds.push(makeCloud(w, h, true))

    window.addEventListener('resize', resizeCanvas)

    // Fetch 24hr best on load
    getDailyBest().then(best => setDailyBest(best))

    // iOS nudge — 15 seconds, with 24hr cooldown
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    const lastDismissed = localStorage.getItem('cloudbop_nudge_dismissed')
    const nudgeSuppressed = lastDismissed &&
      Date.now() - parseInt(lastDismissed) < NUDGE_COOLDOWN
    let nudgeTimer
    if (!isStandalone && !nudgeSuppressed) {
      nudgeTimer = setTimeout(() => setShowNudge(true), 15000)
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      clearTimeout(nudgeTimer)
    }
  }, [])

  // Auto-dismiss nudge after 5s when it appears
  useEffect(() => {
    if (!showNudge) return
    const t = setTimeout(() => dismissNudge(), 5000)
    return () => clearTimeout(t)
  }, [showNudge])

  function resizeCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
  }

  // ── Score / ramp helpers ──────────────────────────────────────────────────
  function checkRamp(s) {
    const tier = Math.floor(s.score / 50)
    if (tier > s.lastRampThreshold) {
      s.lastRampThreshold = tier
      s.speedMult      = Math.min(2.5, 1 + tier * 0.1)
      s.animalInterval = Math.max(ANIMAL_INTERVAL_MIN, ANIMAL_INTERVAL_START - tier * 1000)
    }
  }

  function checkTrophy(s, now) {
    // Suppress v2 share button in timer mode (results screen handles sharing)
    if (timerRef.current.active) return
    const threshold = Math.floor(s.score / 100) * 100
    if (threshold > 0 && threshold > s.lastTrophyThreshold) {
      s.lastTrophyThreshold = threshold
      s.trophyFlash = { startTime: now, duration: 800 }
      play('trophy')

      setShowShare(true)
      if (s.shareHideTimer) clearTimeout(s.shareHideTimer)
      s.shareHideTimer = setTimeout(() => setShowShare(false), 5000)
    }
  }

  // ── Timer controls ────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    // One-play-per-day gate
    if (hasPlayedToday()) {
      setCompPlayedToday(true)
      setTimeout(() => setCompPlayedToday(false), 4000)
      return
    }

    const s = stateRef.current
    const t = timerRef.current

    // Reset game state for a clean run
    s.score               = 0
    s.comboCount          = 0
    s.lastTapTime         = 0
    s.lastRampThreshold   = 0
    s.speedMult           = 1
    s.animalInterval      = ANIMAL_INTERVAL_START
    s.floatingLabels      = []
    s.lastTrophyThreshold = 0
    s.trophyFlash         = null
    s.shakeFrames         = 0
    s.rareGlow            = null
    if (s.shareHideTimer) clearTimeout(s.shareHideTimer)

    // Reset timer
    t.active          = true
    t.ended           = false
    t.startTime       = performance.now()
    t.timeRemaining   = 60
    t.lastFlashSecond = Infinity
    t.lastTickSecond  = Infinity
    t.flashAlpha      = 0

    play('timerStart')

    setShowTimerBtn(false)
    setShowResults(false)
    setShowShare(false)
    setCompPlayedToday(false)
  }, [])

  // Wire up end-timer callback (called from game loop)
  endTimerCallbackRef.current = useCallback(() => {
    const s = stateRef.current
    const finalScore = s.score

    setResultScore(finalScore)

    // Update high score if beaten
    if (finalScore > s.highScore) {
      s.highScore = finalScore
      localStorage.setItem('cloudbop_high', s.highScore)
    }

    // Submit to leaderboard and mark today as played
    submitDailyScore(finalScore)
    markPlayedToday()

    // Refresh 24hr best after submit (slight delay to let insert land)
    setTimeout(() => {
      getDailyBest().then(best => setDailyBest(best))
    }, 800)

    // Win/lose fanfare
    play(finalScore > 50 ? 'timerWinEnd' : 'timerLoseEnd')

    setShowResults(true)
    setShowTimerBtn(false)
  }, [])

  const playAgain = useCallback(() => {
    const t = timerRef.current
    t.active          = false
    t.ended           = false
    t.timeRemaining   = 60
    t.flashAlpha      = 0
    t.lastTickSecond  = Infinity
    t.lastFlashSecond = Infinity

    const s = stateRef.current
    s.score               = 0
    s.comboCount          = 0
    s.lastRampThreshold   = 0
    s.speedMult           = 1
    s.animalInterval      = ANIMAL_INTERVAL_START
    s.floatingLabels      = []
    s.lastTrophyThreshold = 0
    s.trophyFlash         = null
    s.shakeFrames         = 0
    s.rareGlow            = null

    setShowResults(false)
    setShowTimerBtn(true)
    setShowShare(false)
  }, [])

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
    const t = timerRef.current
    if (!s.pointer) return
    // Block taps when timer has ended (results screen is showing)
    if (t.ended) { s.pointer = null; return }

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
          play('animalRare')
          s.floatingLabels.push(makeLabel(tx, ty, '+3 ✨', '#FFD700', '1.6rem', 800))
          s.rareGlow = { startTime: now, duration: 300 }
        } else {
          play('animalNorm')
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
            play('poof')
          } else {
            explodeCloud(c)
            play('explode')
            s.shakeFrames = 3
          }
          s.score += c.points

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
            s.score += s.comboCount
            s.floatingLabels.push(
              makeLabel(tx, ty - 30, `COMBO x${s.comboCount}!`, '#FFE600', '1.6rem', 800)
            )
            // Combo sound: combo5 at 5+, combo3 at exactly 3
            if (s.comboCount >= 5) play('combo5')
            else if (s.comboCount === 3) play('combo3')
          }

          hit = true
          break
        }
      }
    }

    // Update high score (only in free play; timer mode updates on end)
    if (!t.active && s.score > s.highScore) {
      s.highScore = s.score
      localStorage.setItem('cloudbop_high', s.highScore)
    }

    checkRamp(s)
    checkTrophy(s, now)

    s.pointer = null
  }, [])

  // ── Add cloud ─────────────────────────────────────────────────────────────
  const addCloud = useCallback(() => {
    stateRef.current.clouds.push(spawnCloud(window.innerWidth, window.innerHeight))
  }, [])

  // ── Free-play share handler ───────────────────────────────────────────────
  const handleShare = useCallback(() => {
    const s = stateRef.current
    const trophyCount = Math.min(Math.floor(s.score / 100), 5)
    const trophyStr = '🏆'.repeat(trophyCount)
    const text = `I scored ${s.score} in the Cloud Bop Daily Comp! ${trophyStr} Can you beat it? https://www.cloudbop.com`
    if (navigator.share) {
      navigator.share({ title: 'Cloud Bop', text })
        .then(() => setShowShare(false))
        .catch(() => {})
    } else {
      navigator.clipboard.writeText(text)
      setShareCopied(true)
      setTimeout(() => { setShareCopied(false); setShowShare(false) }, 1500)
    }
    if (stateRef.current.shareHideTimer) clearTimeout(stateRef.current.shareHideTimer)
  }, [])

  // ── Results share handler ─────────────────────────────────────────────────
  const handleResultShare = useCallback(() => {
    const score = stateRef.current.score
    const trophyCount = Math.min(Math.floor(score / 100), 5)
    const trophyStr = '🏆'.repeat(trophyCount)
    const text = `I scored ${score} in the Cloud Bop Daily Comp! ${trophyStr} Can you beat it? https://www.cloudbop.com`
    if (navigator.share) {
      navigator.share({ title: 'Cloud Bop', text, url: 'https://www.cloudbop.com' }).catch(() => {})
    } else {
      navigator.clipboard.writeText(text)
      setResultShareCopied(true)
      setTimeout(() => setResultShareCopied(false), 2000)
    }
  }, [])

  // ── Dismiss nudge ─────────────────────────────────────────────────────────
  const dismissNudge = useCallback(() => {
    setShowNudge(false)
    localStorage.setItem('cloudbop_nudge_dismissed', Date.now().toString())
  }, [])

  // ── Game loop ─────────────────────────────────────────────────────────────
  useGameLoop((dt, now) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    const s = stateRef.current
    const t = timerRef.current

    // ── Timer logic ──────────────────────────────────────────────────────
    if (t.active) {
      const elapsed = now - t.startTime
      const secsLeft = Math.max(0, Math.ceil((TIMER_DURATION - elapsed) / 1000))

      // Trigger per-second flash for last 5 seconds
      if (secsLeft <= 5 && secsLeft < t.lastFlashSecond) {
        t.lastFlashSecond = secsLeft
        t.flashAlpha = 0.15
      }

      // Tick sound for last 10 seconds
      if (secsLeft <= 10 && secsLeft < t.lastTickSecond) {
        t.lastTickSecond = secsLeft
        play('timerTick')
      }

      t.timeRemaining = secsLeft

      if (secsLeft <= 0 && !t.ended) {
        t.ended = true
        t.active = false
        endTimerCallbackRef.current()
      }
    }

    // ── Updates (paused when timer has ended) ────────────────────────────
    if (!t.ended) {
      if (now - s.lastAnimalSpawn > s.animalInterval) {
        s.animals.push(spawnAnimal(w, h))
        s.lastAnimalSpawn = now
      }
      s.clouds = updateClouds(s.clouds, dt, now / 1000, w, h, s.speedMult)
      s.animals = updateAnimals(s.animals, w)
    }

    s.floatingLabels = s.floatingLabels.filter(l => now - l.startTime < l.duration)

    // ── Draw ─────────────────────────────────────────────────────────────

    // Screen shake transform
    ctx.save()
    if (s.shakeFrames > 0) {
      ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
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

    // Combo multiplier display (Step 8)
    if (s.comboCount >= 3) {
      ctx.save()
      ctx.font = 'bold 1rem system-ui'
      ctx.fillStyle = '#FFE600'
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 4
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(`COMBO x${s.comboCount}`, w - 20, 90)
      ctx.restore()
    }

    drawFloatingLabels(ctx, s.floatingLabels, now)

    // Trophy flash overlay
    if (s.trophyFlash) {
      const elapsed = now - s.trophyFlash.startTime
      const tf = elapsed / s.trophyFlash.duration
      if (tf < 1) {
        ctx.fillStyle = `rgba(255, 215, 0, ${0.25 * (1 - tf)})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = Math.max(0, 1 - tf)
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
      const rg = elapsed / s.rareGlow.duration
      if (rg < 1) {
        ctx.strokeStyle = `rgba(255, 215, 0, ${0.3 * (1 - rg)})`
        ctx.lineWidth = 20
        ctx.strokeRect(0, 0, w, h)
      } else {
        s.rareGlow = null
      }
    }

    // Timer countdown display
    if (t.active || (t.ended && t.timeRemaining === 0)) {
      // Red flash overlay (last 5 seconds)
      if (t.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 59, 48, ${t.flashAlpha})`
        ctx.fillRect(0, 0, w, h)
        t.flashAlpha = Math.max(0, t.flashAlpha - 0.0125)
      }

      if (t.active) {
        ctx.save()
        ctx.font = 'bold 1.6rem system-ui'
        ctx.fillStyle = t.timeRemaining <= 5 ? '#FF3B30' : 'white'
        ctx.shadowColor = 'rgba(0,0,0,0.4)'
        ctx.shadowBlur = 6
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(`${t.timeRemaining}s`, w / 2, 36)
        ctx.restore()
      }
    }

    ctx.restore() // end shake transform
  })

  // ── Render ────────────────────────────────────────────────────────────────
  const trophyCount = Math.min(Math.floor(resultScore / 100), 5)

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

      {/* Mute button — top-right below score */}
      <button
        id="mute-btn"
        onClick={() => { const nowMuted = toggleMute(); setMuted(nowMuted) }}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {/* Daily Comp button */}
      {showTimerBtn && (
        <button className="timer-btn" onClick={startTimer}>
          🏆 Daily Comp (1 min)
        </button>
      )}

      {/* 24hr best below the comp button */}
      {showTimerBtn && (
        <div id="daily-best">
          {dailyBest !== null ? `24hr best: ${dailyBest}` : '24hr best: —'}
        </div>
      )}

      {/* Already-played-today message */}
      {compPlayedToday && (
        <div id="comp-played-msg">
          You've played today's Daily Comp.<br />Come back tomorrow! ☀️
        </div>
      )}

      {/* Add-cloud FAB */}
      <button
        id="add-cloud-btn"
        onClick={addCloud}
        aria-label="Add cloud"
      >
        ☁️
      </button>

      {/* Free-play share button (trophy milestone) */}
      {showShare && (
        <button className="share-btn" onClick={handleShare}>
          {shareCopied ? 'Copied! ✓' : 'Share my score 🏆'}
        </button>
      )}

      {/* iOS nudge */}
      {showNudge && (
        <div className="nudge-bar" onClick={dismissNudge}>
          <span className="nudge-text">
            ☁️ <strong>Add to home screen for the best experience ✨</strong>
          </span>
          <button className="nudge-dismiss" onClick={dismissNudge}>✕</button>
        </div>
      )}

      {/* Timer results overlay */}
      {showResults && (
        <div id="timer-results">
          <div className="results-inner">
            <h2>Time's Up!</h2>
            <p className="results-score">{resultScore}</p>
            <p className="results-label">points</p>
            <p className="results-trophies">{'🏆'.repeat(trophyCount)}</p>
            <div className="results-daily-best">
              <p className="results-daily-label">24hr best score</p>
              <p className="results-daily-score">
                {dailyBest !== null ? dailyBest : '—'}
              </p>
            </div>
            <div className="results-buttons">
              <button id="results-share" onClick={handleResultShare}>
                {resultShareCopied ? 'Copied! ✓' : '📸 Share Result'}
              </button>
              <button id="results-play-again" onClick={playAgain}>
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
