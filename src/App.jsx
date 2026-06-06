import { useState, useEffect, useRef } from 'react'
import Game from './Game.jsx'
import './App.css'

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setFadeOut(true), 1500)
    const t2 = setTimeout(() => setShowSplash(false), 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  return (
    <>
      {showSplash && (
        <div className={`splash${fadeOut ? ' fade-out' : ''}`}>
          <img src="/icon-512.png" alt="Cloudpop" />
        </div>
      )}
      <div className="game-wrapper">
        <Game />
      </div>
    </>
  )
}
