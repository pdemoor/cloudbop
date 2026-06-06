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
import { drawScore } from './scorer.js'

const ANIMAL_INTERVAL = 10000

export default function Game() {
  const canvasRef = useRef(null)
  const stateRef = useRef({
    clouds: [],
    animals: [],
    score: 0,
    lastAnimalSpawn: 0,
    pointer: null, // { x, y, downX, downY, downTime }
  })

  // Size canvas to viewport
  function resizeCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }

  // Init
  useEffect(() => {
    resizeCanvas()
    const w = window.innerWidth
    const h = window.innerHeight
    const s = stateRef.current
    for (let i = 0; i < 5; i++) {
      s.clouds.push(makeCloud(w, h, true))
    }

    const onResize = () => {
      resizeCanvas()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Pointer handlers
  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    stateRef.current.pointer = { x, y, downX: x, downY: y }
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!stateRef.current.pointer) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    stateRef.current.pointer.x = e.clientX - rect.left
    stateRef.current.pointer.y = e.clientY - rect.top
  }, [])

  const onPointerUp = useCallback((e) => {
    const s = stateRef.current
    if (!s.pointer) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const upX = e.clientX - rect.left
    const upY = e.clientY - rect.top
    const dx = upX - s.pointer.downX
    const dy = upY - s.pointer.downY
    const velocity = Math.sqrt(dx * dx + dy * dy)
    const tx = s.pointer.downX
    const ty = s.pointer.downY

    // Check animals first
    let hit = false
    for (const a of s.animals) {
      if (hitTestAnimal(a, tx, ty)) {
        bopAnimal(a)
        s.score += 1
        hit = true
        break
      }
    }

    if (!hit) {
      for (const c of s.clouds) {
        if (hitTest(c, tx, ty)) {
          if (velocity < 12) {
            poofCloud(c)
          } else {
            explodeCloud(c)
          }
          s.score += 1
          break
        }
      }
    }

    s.pointer = null
  }, [])

  // Add cloud button handler
  const addCloud = useCallback(() => {
    const s = stateRef.current
    const w = window.innerWidth
    const h = window.innerHeight
    s.clouds.push(spawnCloud(w, h))
  }, [])

  // Game loop
  useGameLoop((dt, now) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    const s = stateRef.current

    // Spawn animal on interval
    if (now - s.lastAnimalSpawn > ANIMAL_INTERVAL) {
      s.animals.push(spawnAnimal(w, h))
      s.lastAnimalSpawn = now
    }

    // Update
    s.clouds = updateClouds(s.clouds, dt, now / 1000, w, h)
    s.animals = updateAnimals(s.animals, w)

    // Draw background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#1AADDF')
    grad.addColorStop(1, '#87CEEB')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // Draw game objects
    drawClouds(ctx, s.clouds)
    drawAnimals(ctx, s.animals)
    drawScore(ctx, s.score, w)
  })

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
        + Cloud
      </button>
    </>
  )
}
