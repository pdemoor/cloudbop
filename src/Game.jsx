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
  submitDailyScore, getDailyBest, getTopDaily,
  hasPlayedToday, markPlayedToday,
} from './supabase.js'
import { play, toggleMute, playThunder } from './sounds.js'
import { getSecondsUntil5am, formatCountdown, getTrophyCount } from './utils.js'

const ANIMAL_INTERVAL_START = 10000
const ANIMAL_INTERVAL_MIN   = 5000
const COMBO_WINDOW          = 1500
const TIMER_DURATION        = 60000

// Safe play area — keep clouds and animals out of UI chrome
const TOP_MARGIN    = 90   // px — clouds and animals stay below this
const BOTTOM_MARGIN = 130  // px — clouds and animals stay above this

function makeLabel(x, y, text, colour, fontSize, duration) {
  return { x, y, text, colour, fontSize, duration, startTime: performance.now() }
}

export default function Game() {
  const canvasRef = useRef(null)

  // ── React state ───────────────────────────────────────────────────────────
  const [showShare, setShowShare]                   = useState(false)
  const [shareCopied, setShareCopied]               = useState(false)
  const [showTimerBtn, setShowTimerBtn]             = useState(true)
  const [showResults, setShowResults]               = useState(false)
  const [resultScore, setResultScore]               = useState(0)
  const [resultShareCopied, setResultShareCopied]   = useState(false)
  const [dailyBest, setDailyBest]                   = useState(null)
  const [muted, setMuted]                           = useState(false)

  // Lockout popup
  const [showLockout, setShowLockout]               = useState(false)
  const [lockoutScore, setLockoutScore]             = useState(0)
  const [leaderboard, setLeaderboard]               = useState([])
  const [countdown, setCountdown]                   = useState('')

  // Initials entry
  const [showInitialsEntry, setShowInitialsEntry]   = useState(false)
  const [playerInitials, setPlayerInitials]         = useState('')

  // Flash add-cloud button when no alive clouds remain
  const [flashAddBtn, setFlashAddBtn]               = useState(false)
  const flashAddBtnRef                              = useRef(false)

  // Info modal
  const [showInfoModal, setShowInfoModal]           = useState(false)

  // Background pulse behind Daily Comp button
  const [showCompPulse, setShowCompPulse]           = useState(false)

  function stopCompPulse() {
    setShowCompPulse(false)
  }

  // ── Game state ref ────────────────────────────────────────────────────────
  const stateRef = useRef({
    clouds: [],
    animals: [],
    score: 0,
    highScore: parseInt(localStorage.getItem('cloudbop_high') || '0'),
    lastAnimalSpawn: 0,
    pointer: null,

    comboCount: 0,
    lastTapTime: 0,

    speedMult: 1,
    animalInterval: ANIMAL_INTERVAL_START,
    lastRampThreshold: 0,

    floatingLabels: [],
    shakeFrames: 0,

    trophyFlash: null,
    lastTrophyCount: 0,   // tracks getTrophyCount(score) milestones

    rareGlow: null,
    shareHideTimer: null,

    // Weather system
    raindrops: [],
    lightning: {
      active: false,
      flashAlpha: 0,
      boltPoints: [],
      timer: 0,
      cooldown: 0,
    },
  })

  // ── Timer ref ─────────────────────────────────────────────────────────────
  const timerRef = useRef({
    active: false,
    ended: false,
    startTime: null,
    timeRemaining: 60,
    lastFlashSecond: Infinity,
    lastTickSecond: Infinity,
    flashAlpha: 0,
  })

  const endTimerCallbackRef = useRef(null)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    resizeCanvas()
    const w = window.innerWidth
    const h = window.innerHeight
    const s = stateRef.current
    for (let i = 0; i < 5; i++) s.clouds.push(makeCloud(w, h, true, TOP_MARGIN, BOTTOM_MARGIN))

    window.addEventListener('resize', resizeCanvas)
    getDailyBest().then(best => setDailyBest(best))

    localStorage.removeItem('cloudbop_nudge_dismissed')

    return () => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  // Pulse check — runs on mount and every 60s
  useEffect(() => {
    function checkPulse() {
      if (hasPlayedToday()) {
        setShowCompPulse(false)
        return
      }
      const now = new Date()
      const todayAt5am = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        5, 0, 0, 0
      )
      setShowCompPulse(now >= todayAt5am)
    }

    checkPulse()
    const interval = setInterval(checkPulse, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!showLockout) return
    const interval = setInterval(() => {
      setCountdown(formatCountdown(getSecondsUntil5am()))
    }, 1000)
    return () => clearInterval(interval)
  }, [showLockout])

  function resizeCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
  }

  // ── Trophy / ramp helpers ─────────────────────────────────────────────────
  function checkRamp(s) {
    const tier = Math.floor(s.score / 50)
    if (tier > s.lastRampThreshold) {
      s.lastRampThreshold = tier
      s.speedMult      = Math.min(2.5, 1 + tier * 0.1)
      s.animalInterval = Math.max(ANIMAL_INTERVAL_MIN, ANIMAL_INTERVAL_START - tier * 1000)
    }
  }

  function checkTrophy(s, now) {
    if (timerRef.current.active) return
    const newCount = getTrophyCount(s.score)
    if (newCount > s.lastTrophyCount) {
      s.lastTrophyCount = newCount
      s.trophyFlash = { startTime: now, duration: 800 }
      play('trophy')

      setShowShare(true)
      if (s.shareHideTimer) clearTimeout(s.shareHideTimer)
      s.shareHideTimer = setTimeout(() => setShowShare(false), 5000)
    }
  }

  // ── Weather helpers ───────────────────────────────────────────────────────

  function getRainTier(combo) {
    if (combo >= 50) return 'heavy'
    if (combo >= 10) return 'light'
    return 'none'
  }

  function generateBolt(canvas) {
    const startX = canvas.width * 0.2 + Math.random() * canvas.width * 0.6
    const points = [{ x: startX, y: 0 }]
    let y = 0, x = startX
    while (y < canvas.height * 0.75) {
      y += 18 + Math.random() * 22
      x += (Math.random() - 0.5) * 60
      x  = Math.max(20, Math.min(canvas.width - 20, x))
      points.push({ x, y })
    }
    return points
  }

  function drawWeatherOverlay(ctx, w, h, rainTier) {
    if (rainTier === 'none') return
    ctx.fillStyle = `rgba(30, 50, 90, ${rainTier === 'heavy' ? 0.22 : 0.10})`
    ctx.fillRect(0, 0, w, h)
  }

  function drawRain(ctx, raindrops) {
    raindrops.forEach(d => {
      ctx.save()
      ctx.globalAlpha   = d.alpha
      ctx.strokeStyle   = 'rgba(180, 210, 255, 1)'
      ctx.lineWidth     = 1.2
      ctx.lineCap       = 'round'
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x + d.vx * 2, d.y + d.length)
      ctx.stroke()
      ctx.restore()
    })
  }

  function drawLightning(ctx, w, h, lightning) {
    if (!lightning.active) return
    // Screen flash
    ctx.fillStyle = `rgba(255, 255, 240, ${lightning.flashAlpha * 0.35})`
    ctx.fillRect(0, 0, w, h)
    const pts = lightning.boltPoints
    if (pts.length < 2) return
    ctx.save()
    // Glow pass
    ctx.strokeStyle = `rgba(180, 200, 255, ${lightning.flashAlpha * 0.6})`
    ctx.lineWidth   = 8
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.shadowColor = '#aaddff'
    ctx.shadowBlur  = 24
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
    ctx.stroke()
    // Core bolt
    ctx.strokeStyle = `rgba(255, 255, 255, ${lightning.flashAlpha})`
    ctx.lineWidth   = 2.5
    ctx.shadowBlur  = 8
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
    ctx.stroke()
    ctx.restore()
  }

  function drawWeatherIndicator(ctx, w, combo) {
    if (combo < 10) return
    const icon = combo >= 100 ? '⛈️' : combo >= 50 ? '🌩️' : '🌧️'
    ctx.save()
    ctx.font          = '1.1rem serif'
    ctx.textAlign     = 'center'
    ctx.textBaseline  = 'top'
    ctx.globalAlpha   = 0.75
    ctx.fillText(icon, w / 2, 68)
    ctx.restore()
  }

  // ── Timer controls ────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    stopCompPulse()

    if (hasPlayedToday()) {
      const savedScore = parseInt(
        localStorage.getItem('cloudbop_last_comp_score') || '0'
      )
      setLockoutScore(savedScore)
      setLeaderboard([])           // clear stale data while fetching
      setShowLockout(true)
      setCountdown(formatCountdown(getSecondsUntil5am()))
      getTopDaily()
        .then(rows => setLeaderboard(rows))
        .catch(err => console.error('[lockout] getTopDaily failed:', err))
      return
    }

    const s = stateRef.current
    const t = timerRef.current

    s.score             = 0
    s.comboCount        = 0
    s.lastTapTime       = 0
    s.lastRampThreshold = 0
    s.speedMult         = 1
    s.animalInterval    = ANIMAL_INTERVAL_START
    s.lastAnimalSpawn   = 0  // reset so first animal spawns promptly
    s.floatingLabels    = []
    s.lastTrophyCount   = 0
    s.trophyFlash       = null
    s.shakeFrames       = 0
    s.rareGlow          = null
    s.raindrops         = []
    s.lightning         = { active: false, flashAlpha: 0, boltPoints: [], timer: 0, cooldown: 0 }
    if (s.shareHideTimer) clearTimeout(s.shareHideTimer)

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
    setShowInitialsEntry(false)
    setPlayerInitials('')
  }, [])

  // Async end-timer callback — checks leaderboard qualification before submitting
  endTimerCallbackRef.current = async () => {
    const s = stateRef.current
    const finalScore = s.score

    setResultScore(finalScore)

    if (finalScore > s.highScore) {
      s.highScore = finalScore
      localStorage.setItem('cloudbop_high', s.highScore)
    }

    play(finalScore > 50 ? 'timerWinEnd' : 'timerLoseEnd')
    stopCompPulse()
    setShowResults(true)
    setShowTimerBtn(false)

    // Check leaderboard qualification
    try {
      const lb = await getTopDaily()
      setLeaderboard(lb)

      const qualifies =
        lb.length < 100 ||
        finalScore > lb[lb.length - 1].score

      if (qualifies) {
        setShowInitialsEntry(true)
      } else {
        submitDailyScore(finalScore)
        markPlayedToday()
        localStorage.setItem('cloudbop_last_comp_score', String(finalScore))
      }

      // Refresh 24hr best
      setTimeout(() => {
        getDailyBest().then(best => setDailyBest(best))
      }, 800)
    } catch {
      // Network failure — submit without initials
      submitDailyScore(finalScore)
      markPlayedToday()
      localStorage.setItem('cloudbop_last_comp_score', String(finalScore))
    }
  }

  const playAgain = useCallback(() => {
    const t = timerRef.current
    t.active          = false
    t.ended           = false
    t.timeRemaining   = 60
    t.flashAlpha      = 0
    t.lastTickSecond  = Infinity
    t.lastFlashSecond = Infinity

    const s = stateRef.current
    s.score             = 0
    s.comboCount        = 0
    s.lastRampThreshold = 0
    s.speedMult         = 1
    s.animalInterval    = ANIMAL_INTERVAL_START
    s.floatingLabels    = []
    s.lastTrophyCount   = 0
    s.trophyFlash       = null
    s.shakeFrames       = 0
    s.rareGlow          = null
    s.raindrops         = []
    s.lightning         = { active: false, flashAlpha: 0, boltPoints: [], timer: 0, cooldown: 0 }

    setShowResults(false)
    setShowTimerBtn(true)
    setShowShare(false)
    setShowInitialsEntry(false)
    setPlayerInitials('')
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
            if (s.comboCount >= 5) play('combo5')
            else if (s.comboCount === 3) play('combo3')
          }

          hit = true
          break
        }
      }
    }

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
    stateRef.current.clouds.push(
      spawnCloud(window.innerWidth, window.innerHeight, TOP_MARGIN, BOTTOM_MARGIN)
    )
  }, [])

  // ── Share handlers ────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    const s = stateRef.current
    const trophyStr = '🏆'.repeat(getTrophyCount(s.score))
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

  const handleResultShare = useCallback(() => {
    const score = stateRef.current.score
    const trophyStr = '🏆'.repeat(getTrophyCount(score))
    const text = `I scored ${score} in the Cloud Bop Daily Comp! ${trophyStr} Can you beat it? https://www.cloudbop.com`
    if (navigator.share) {
      navigator.share({ title: 'Cloud Bop', text, url: 'https://www.cloudbop.com' }).catch(() => {})
    } else {
      navigator.clipboard.writeText(text)
      setResultShareCopied(true)
      setTimeout(() => setResultShareCopied(false), 2000)
    }
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

    if (t.active) {
      const elapsed = now - t.startTime
      const secsLeft = Math.max(0, Math.ceil((TIMER_DURATION - elapsed) / 1000))

      if (secsLeft <= 5 && secsLeft < t.lastFlashSecond) {
        t.lastFlashSecond = secsLeft
        t.flashAlpha = 0.15
      }
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

    // NOTE: animals spawn during both free play AND
    // Daily Comp timer mode — do not gate on timer state
    if (!t.ended) {
      if (now - s.lastAnimalSpawn > s.animalInterval) {
        s.animals.push(spawnAnimal(w, h, TOP_MARGIN, BOTTOM_MARGIN))
        s.lastAnimalSpawn = now
      }
      s.clouds = updateClouds(s.clouds, dt, now / 1000, w, h, s.speedMult, TOP_MARGIN, BOTTOM_MARGIN)
      s.animals = updateAnimals(s.animals, w, h, BOTTOM_MARGIN)

      // Flash add-cloud button when no alive clouds remain
      const noAlive = s.clouds.every(c => c.state !== 'alive')
      if (noAlive !== flashAddBtnRef.current) {
        flashAddBtnRef.current = noAlive
        setFlashAddBtn(noAlive)
      }
    }

    s.floatingLabels = s.floatingLabels.filter(l => now - l.startTime < l.duration)

    // ── Weather update ────────────────────────────────────────────────────
    const rainTier = getRainTier(s.comboCount)

    if (rainTier === 'none') {
      // Clear all weather immediately when combo drops
      s.raindrops = []
      s.lightning.active    = false
      s.lightning.flashAlpha = 0
      s.lightning.cooldown  = 0
    } else {
      // Spawn new raindrops
      const spawnCount = rainTier === 'heavy'
        ? 10 + Math.floor(Math.random() * 6)
        : 3  + Math.floor(Math.random() * 3)
      for (let i = 0; i < spawnCount; i++) {
        s.raindrops.push({
          x: Math.random() * w,
          y: -20,
          vy: rainTier === 'heavy' ? 12 + Math.random() * 6 : 6 + Math.random() * 4,
          length: rainTier === 'heavy' ? 20 + Math.random() * 12 : 12 + Math.random() * 8,
          alpha: rainTier === 'heavy' ? 0.25 + Math.random() * 0.25 : 0.15 + Math.random() * 0.2,
          vx: 0.5 + Math.random() * 1.0,
        })
      }
      // Move and cull raindrops
      s.raindrops = s.raindrops
        .filter(d => d.y < h + 40)
        .map(d => ({ ...d, x: d.x + d.vx, y: d.y + d.vy }))
      if (s.raindrops.length > 600) s.raindrops = s.raindrops.slice(-600)

      // Lightning
      const lt = s.lightning
      if (lt.cooldown > 0) {
        lt.cooldown--
      } else if (s.comboCount >= 50) {
        const chance = s.comboCount >= 100 ? 0.020 : 0.004
        if (Math.random() < chance) {
          lt.active     = true
          lt.flashAlpha = 0.7
          lt.timer      = 12
          lt.boltPoints = generateBolt(canvas)
          lt.cooldown   = s.comboCount >= 100
            ? 40  + Math.floor(Math.random() * 40)
            : 120 + Math.floor(Math.random() * 180)
          const comboSnap = s.comboCount
          setTimeout(() => playThunder(comboSnap),
            comboSnap >= 100 ? 80 : 300)
        }
      }
      if (lt.active) {
        lt.timer--
        lt.flashAlpha *= 0.75
        if (lt.timer <= 0) { lt.active = false; lt.flashAlpha = 0 }
      }
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    ctx.save()
    if (s.shakeFrames > 0) {
      ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
      s.shakeFrames--
    }

    // 1. Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#1AADDF')
    grad.addColorStop(1, '#87CEEB')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // 2. Weather overlay (dark tint)
    drawWeatherOverlay(ctx, w, h, rainTier)

    // 3. Rain streaks
    drawRain(ctx, s.raindrops)

    // 4. Lightning
    drawLightning(ctx, w, h, s.lightning)

    // 5. Weather indicator icon
    drawWeatherIndicator(ctx, w, s.comboCount)

    // 6. Clouds
    drawClouds(ctx, s.clouds)

    // 7. Animals
    drawAnimals(ctx, s.animals)

    drawScore(ctx, s.score, s.highScore, w, t.active)

    if (s.comboCount >= 3) {
      ctx.save()
      ctx.font = 'bold 1rem system-ui'
      ctx.fillStyle = '#FFE600'
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 4
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      // Centre over the Daily Comp button area (left: 12px, ~130px wide → centre ≈ 77px)
      ctx.fillText(`COMBO x${s.comboCount}`, 77, 82)
      ctx.restore()
    }

    drawFloatingLabels(ctx, s.floatingLabels, now)

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

    if (t.active || (t.ended && t.timeRemaining === 0)) {
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
        ctx.textBaseline = 'top'
        // Draw below the game logo (logo spans y=12–60 in viewport)
        ctx.fillText(`${Math.ceil(t.timeRemaining)}s`, w / 2, 64)
        ctx.restore()
      }
    }

    ctx.restore()
  })

  // ── Render ────────────────────────────────────────────────────────────────
  const trophyCount = getTrophyCount(resultScore)

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

      {/* Info button — bottom-left */}
      <button
        id="info-btn"
        onClick={() => setShowInfoModal(true)}
        aria-label="How to play"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="white"
          width="22"
          height="22"
        >
          <circle cx="12" cy="12" r="10" fill="none"
            stroke="white" strokeWidth="2"/>
          <line x1="12" y1="11" x2="12" y2="17"
            stroke="white" strokeWidth="2.5"
            strokeLinecap="round"/>
          <circle cx="12" cy="7.5" r="1.4" fill="white"/>
        </svg>
      </button>

      {/* Mute button — bottom-right */}
      <button
        id="mute-btn"
        className={muted ? 'muted' : ''}
        onClick={() => { const nowMuted = toggleMute(); setMuted(nowMuted) }}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="white"
          width="22"
          height="22"
        >
          {muted ? (
            <>
              <path d="M13 3.17v17.66a1 1 0 01-1.7.7L6.59 17H4a1 1 0 01-1-1V8a1 1 0 011-1h2.59l4.71-4.53A1 1 0 0113 3.17z"/>
              <line x1="18" y1="9" x2="23" y2="14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="23" y1="9" x2="18" y2="14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            </>
          ) : (
            <>
              <path d="M13 3.17v17.66a1 1 0 01-1.7.7L6.59 17H4a1 1 0 01-1-1V8a1 1 0 011-1h2.59l4.71-4.53A1 1 0 0113 3.17z"/>
              <path d="M16 9a5 5 0 010 6" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
              <path d="M19.07 6.93a9 9 0 010 10.14" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </>
          )}
        </svg>
      </button>

      {/* Daily Comp pulse — behind the button (z-index 9) */}
      {showTimerBtn && showCompPulse === true && (
        <div id="comp-pulse" />
      )}

      {/* Daily Comp button */}
      {showTimerBtn && (
        <button id="daily-comp-btn" className="timer-btn" onClick={startTimer}>
          <span className="trophy-icon">🏆</span>{' '}Daily Comp
        </button>
      )}

      {showTimerBtn && (
        <div id="daily-best">
          {dailyBest !== null ? `24hr best: ${dailyBest}` : '24hr best: —'}
        </div>
      )}

      {/* Add-cloud FAB */}
      <button
        id="add-cloud-btn"
        className={flashAddBtn ? 'flash' : ''}
        onClick={addCloud}
        aria-label="Add cloud"
      >
        ☁️
      </button>

      {/* Free-play share */}
      {showShare && (
        <button className="share-btn" onClick={handleShare}>
          {shareCopied ? 'Copied! ✓' : 'Share my score 🏆'}
        </button>
      )}

      {/* Lockout popup */}
      {showLockout && (
        <div id="lockout-overlay">
          <div className="lockout-inner">
            <button
              className="popup-close-x"
              onClick={() => setShowLockout(false)}
              aria-label="Close"
            >✕</button>
            <h2>You've played today! 🎉</h2>
            <p className="lockout-label">Your score</p>
            <p className="lockout-score">{lockoutScore}</p>

            <div className="lockout-countdown">
              <p className="lockout-countdown-label">Next comp unlocks at 5am</p>
              <p className="lockout-countdown-timer">{countdown}</p>
            </div>

            <div className="lockout-leaderboard">
              <p className="lockout-lb-title">24hr Top 100</p>
              {leaderboard.length === 0 ? (
                <p className="lockout-lb-empty">No scores yet</p>
              ) : (
                <div className="lockout-lb-scroll">
                  <ol className="lockout-lb-list">
                    {leaderboard.map((entry, i) => (
                      <li
                        key={i}
                        className={`lockout-lb-item${
                          i === 0 ? ' lockout-lb-first'
                          : i === 1 ? ' lockout-lb-second'
                          : i === 2 ? ' lockout-lb-third'
                          : ''
                        }`}
                      >
                        <span className="lb-rank">
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                        </span>
                        <span className="lb-initials">
                          {entry.initials || '···'}
                        </span>
                        <span className="lb-score">{entry.score}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <button className="lockout-close" onClick={() => setShowLockout(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Timer results overlay */}
      {showResults && (
        <div id="timer-results">
          <div className="results-inner">
            <button
              className="popup-close-x"
              onClick={() => setShowResults(false)}
              aria-label="Close"
            >✕</button>
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

            <div className="results-leaderboard">
              <p className="lockout-lb-title">24hr Top 100</p>
              {leaderboard.length === 0 ? (
                <p className="lockout-lb-empty">Loading...</p>
              ) : (
                <div className="lockout-lb-scroll">
                  <ol className="lockout-lb-list">
                    {leaderboard.map((entry, i) => (
                      <li
                        key={i}
                        className={`lockout-lb-item${
                          i === 0 ? ' lockout-lb-first'
                          : i === 1 ? ' lockout-lb-second'
                          : i === 2 ? ' lockout-lb-third'
                          : ''}`}
                      >
                        <span className="lb-rank">
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                        </span>
                        <span className="lb-initials">
                          {entry.initials || '···'}
                        </span>
                        <span className="lb-score">{entry.score}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="results-buttons">
              <button id="results-share" onClick={handleResultShare}>
                {resultShareCopied ? 'Copied! ✓' : '📸 Share Result'}
              </button>
              <button id="results-play-again" onClick={playAgain}>
                Free Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info / How to Play modal */}
      {showInfoModal && (
        <div id="info-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="info-inner" onClick={e => e.stopPropagation()}>
            <button
              className="popup-close-x"
              onClick={() => setShowInfoModal(false)}
              aria-label="Close"
            >✕</button>
            <h2>☁️ How to Play</h2>

            <div className="info-section">
              <h3>Bopping clouds</h3>
              <p>
                <strong>Bop lightly</strong> — cloud poofs away softly.<br/>
                <strong>Swipe fast</strong> — cloud explodes with a bang!<br/>
                Each bop scores <strong>1 point</strong> (small clouds = 2 pts).
              </p>
            </div>

            <div className="info-section">
              <h3>Flying animals</h3>
              <p>
                Every 10 seconds a creature flies across.<br/>
                <strong>Bop it</strong> for a bonus point.<br/>
                🐉 🦄 🧚 are <strong>rare</strong> — worth 3 points!
              </p>
            </div>

            <div className="info-section">
              <h3>Combos &amp; Weather</h3>
              <p>
                Bop clouds quickly — within 1.5 seconds of each other
                — to build a combo streak.<br/><br/>
                <strong>Combo scoring:</strong><br/>
                Each bop in a combo awards <strong>bonus points
                equal to your combo count</strong>. So your 3rd
                quick bop scores +3, your 10th scores +10, and so
                on. This is how scores grow rapidly!<br/><br/>
                <strong>Weather effects:</strong><br/>
                <strong>x10</strong> — light rain appears 🌧️<br/>
                <strong>x50</strong> — lightning strikes 🌩️<br/>
                <strong>x100</strong> — full storm ⛈️<br/><br/>
                Combos reset if you wait more than 1.5 seconds
                between bops.
              </p>
            </div>

            <div className="info-section">
              <h3>🏆 Daily Comp</h3>
              <p>
                One 60-second timed round per day.<br/>
                Resets at <strong>5am</strong> each morning.<br/>
                Enter your initials if you make the top 100.<br/>
                See how you rank on the <strong>24hr leaderboard</strong>.
              </p>
            </div>

            <div className="info-section info-homescreen">
              <h3>📱 Add to Home Screen</h3>
              <p>
                <strong>iPhone:</strong> tap the Share button in Safari
                then <em>"Add to Home Screen"</em> for the best experience.<br/>
                <strong>Android:</strong> tap the menu (⋮) then{' '}
                <em>"Add to Home Screen"</em>.
              </p>
            </div>

            <button
              className="info-close"
              onClick={() => setShowInfoModal(false)}
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* Initials entry — overlays results (z-index 70) */}
      {showInitialsEntry && (
        <div id="initials-overlay">
          <div className="initials-inner">
            <h2>🏆 You made the board!</h2>
            <p className="initials-label">Enter your initials</p>
            <input
              id="initials-input"
              type="text"
              maxLength={3}
              value={playerInitials}
              onChange={e => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                setPlayerInitials(val)
              }}
              placeholder="AAA"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              className="initials-submit"
              disabled={playerInitials.length !== 3}
              onClick={async () => {
                await submitDailyScore(resultScore, playerInitials)
                markPlayedToday()
                localStorage.setItem('cloudbop_last_comp_score', String(resultScore))
                setShowInitialsEntry(false)
                getTopDaily().then(scores => setLeaderboard(scores))
              }}
            >
              Submit
            </button>
            <button
              className="initials-skip"
              onClick={() => {
                submitDailyScore(resultScore)
                markPlayedToday()
                localStorage.setItem('cloudbop_last_comp_score', String(resultScore))
                setShowInitialsEntry(false)
                getTopDaily().then(scores => setLeaderboard(scores))
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </>
  )
}
