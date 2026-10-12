import { useEffect, useState, type RefObject } from 'react'

// One shared IntersectionObserver for all cards: true once the element is on (or near) the screen.
const callbacks = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | undefined

function getObserver() {
  return (observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        callbacks.get(e.target)?.()
        callbacks.delete(e.target)
        observer!.unobserve(e.target)
      }
    },
    { rootMargin: '600px 0px' },
  ))
}

export function useSeen(ref: RefObject<Element>) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    callbacks.set(el, () => setSeen(true))
    getObserver().observe(el)
    return () => {
      callbacks.delete(el)
      getObserver().unobserve(el)
    }
  }, [seen])
  return seen
}
