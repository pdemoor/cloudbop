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
import { play, toggleMute } from './sounds.js'
import { getSecondsUntil5am, formatCountdown, getTrophyCount } from './utils.js'

const ANIMAL_INTERVAL_START = 10000
const ANIMAL_INTERVAL_MIN   = 5000
const COMBO_WINDOW          = 1500
const TIMER_DURATION        = 60000
const NUDGE_COOLDOWN        = 24 * 60 * 60 * 1000

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
  const [showNudge, setShowNudge]                   = useState(false)
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

  useEffect(() => {
    if (!showNudge) return
    const t = setTimeout(() => dismissNudge(), 5000)
    return () => clearTimeout(t)
  }, [showNudge])

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

  // ── Timer controls ────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (hasPlayedToday()) {
      const savedScore = parseInt(
        localStorage.getItem('cloudbop_last_comp_score') || '0'
      )
      setLockoutScore(savedScore)
      setLeaderboard([])           // clear stale data while fetching
      setShowLockout(true)
      setCountdown(formatCountdown(getSecondsUntil5am()))
      getTopDaily()
        .then(rows => {
          console.log('[lockout] leaderboard rows:', rows)
          setLeaderboard(rows)
        })
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
    s.floatingLabels    = []
    s.lastTrophyCount   = 0
    s.trophyFlash       = null
    s.shakeFrames       = 0
    s.rareGlow          = null
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
    setShowResults(true)
    setShowTimerBtn(false)

    // Check leaderboard qualification
    try {
      const lb = await getTopDaily()
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

    if (!t.ended) {
      if (now - s.lastAnimalSpawn > s.animalInterval) {
        s.animals.push(spawnAnimal(w, h, TOP_MARGIN, BOTTOM_MARGIN))
        s.lastAnimalSpawn = now
      }
      s.clouds = updateClouds(s.clouds, dt, now / 1000, w, h, s.speedMult, TOP_MARGIN, BOTTOM_MARGIN)
      s.animals = updateAnimals(s.animals, w)
    }

    s.floatingLabels = s.floatingLabels.filter(l => now - l.startTime < l.duration)

    ctx.save()
    if (s.shakeFrames > 0) {
      ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
      s.shakeFrames--
    }

    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#1AADDF')
    grad.addColorStop(1, '#87CEEB')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    drawClouds(ctx, s.clouds)
    drawAnimals(ctx, s.animals)
    drawScore(ctx, s.score, s.highScore, w)

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
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(`${t.timeRemaining}s`, w / 2, 36)
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

      {/* Daily Comp button */}
      {showTimerBtn && (
        <button id="daily-comp-btn" className="timer-btn" onClick={startTimer}>
          🏆 Daily Comp (1 min)
        </button>
      )}

      {showTimerBtn && (
        <div id="daily-best">
          {dailyBest !== null ? `24hr best: ${dailyBest}` : '24hr best: —'}
        </div>
      )}

      {/* Add-cloud FAB */}
      <button id="add-cloud-btn" onClick={addCloud} aria-label="Add cloud">
        ☁️
      </button>

      {/* Free-play share */}
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

      {/* Lockout popup */}
      {showLockout && (
        <div id="lockout-overlay">
          <div className="lockout-inner">
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
