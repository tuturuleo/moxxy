import { hostOf } from './bookmarks'

export interface Job {
  /** = url */
  id: string
  url: string
  forceTab?: boolean
  liveTabId?: number
  /** Requested by the user right now: goes ahead of everything. */
  urgent?: boolean
}

/**
 * Background parse queue: limited global concurrency, one request per host at a time
 * and a pause between requests to the same host so sites don't rate-limit us.
 */
export class ParseQueue {
  private jobs = new Map<string, Job>()
  private running = new Set<string>()
  private busyHosts = new Set<string>()
  private hostNext = new Map<string, number>()
  private timer?: ReturnType<typeof setTimeout>
  private done = 0
  private total = 0
  /** Lower runs first. */
  priority: (job: Job) => number = () => 1

  constructor(
    private worker: (job: Job) => Promise<void>,
    private onProgress: (done: number, total: number) => void,
    private concurrency = 4,
    private hostGapMs = 800,
  ) {}

  add(jobs: Job[]) {
    for (const j of jobs) {
      if (this.running.has(j.id)) continue
      if (!this.jobs.has(j.id)) this.total++
      this.jobs.set(j.id, j)
    }
    this.emit()
    this.pump()
  }

  remove(ids: Iterable<string>) {
    for (const id of ids) if (this.jobs.delete(id)) this.total--
    this.emit()
  }

  isQueued = (id: string) => this.jobs.has(id) || this.running.has(id)

  private pump = () => {
    clearTimeout(this.timer)
    if (!this.jobs.size) return
    const now = Date.now()
    const list = [...this.jobs.values()].sort((a, b) => (a.urgent ? -1 : this.priority(a)) - (b.urgent ? -1 : this.priority(b)))
    let wait = Infinity
    for (const job of list) {
      if (this.running.size >= this.concurrency) break
      const host = hostOf(job.url)
      if (this.busyHosts.has(host)) continue
      const next = this.hostNext.get(host) ?? 0
      if (next > now) {
        wait = Math.min(wait, next - now)
        continue
      }
      this.start(job, host)
    }
    if (wait < Infinity) this.timer = setTimeout(this.pump, wait + 20)
  }

  private start(job: Job, host: string) {
    this.jobs.delete(job.id)
    this.running.add(job.id)
    this.busyHosts.add(host)
    // a job that never settles must not hold its slot (and its host) forever
    Promise.race([this.worker(job), new Promise((r) => setTimeout(r, 120_000))])
      .catch(() => {})
      .finally(() => {
        this.running.delete(job.id)
        this.busyHosts.delete(host)
        this.hostNext.set(host, Date.now() + this.hostGapMs)
        this.done++
        this.emit()
        this.pump()
      })
  }

  private emit() {
    if (!this.jobs.size && !this.running.size) this.done = this.total = 0
    this.onProgress(this.done, this.total)
  }
}
