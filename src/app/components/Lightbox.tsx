import { useEffect, useState } from 'react'

export function Lightbox({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  const go = (d: number) => setI((v) => (v + d + images.length) % images.length)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={images[i]} referrerPolicy="no-referrer" alt=""/>
      {images.length > 1 && (
        <>
          <button className="lb-nav prev" onClick={(e) => (e.stopPropagation(), go(-1))}>‹</button>
          <button className="lb-nav next" onClick={(e) => (e.stopPropagation(), go(1))}>›</button>
          <div className="lb-count">
            {i + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}
