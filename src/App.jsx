import { useState, useEffect } from 'react'
import Game from './Game.jsx'
import './App.css'

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const [showHowTo, setShowHowTo] = useState(
    !localStorage.getItem('cloudbop_howto_seen')
  )

  useEffect(() => {
    const t1 = setTimeout(() => setFadeOut(true), 1500)
    const t2 = setTimeout(() => setShowSplash(false), 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // Auto-dismiss how-to after 5 seconds
  useEffect(() => {
    if (!showHowTo) return
    const t = setTimeout(dismissHowTo, 5000)
    return () => clearTimeout(t)
  }, [showHowTo])

  function dismissHowTo() {
    localStorage.setItem('cloudbop_howto_seen', '1')
    setShowHowTo(false)
  }

  return (
    <>
      {showSplash && (
        <div className={`splash${fadeOut ? ' fade-out' : ''}`}>
          <img src="/icon-512.png" alt="Cloud Bop" />
          <p className="splash-tagline">
            Bop clouds. Chase combos.<br />60 seconds of cute chaos.
          </p>
        </div>
      )}
      {!showSplash && (
        <img
          id="game-logo"
          src="/icon-192.png"
          alt="Cloud Bop"
        />
      )}
      {!showSplash && showHowTo && (
        <div id="howto-tooltip" onClick={dismissHowTo}>
          <p>👆 Bop lightly = poof</p>
          <p>👋 Swipe hard = explode</p>
          <p>🦋 Bop animals for bonus!</p>
          <p className="howto-dismiss">Bop to dismiss</p>
        </div>
      )}
      <div className="game-wrapper">
        <Game />
      </div>
    </>
  )
}
