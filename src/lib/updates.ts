// Update check against the GitHub releases of the repo in manifest.homepage_url.
// Moxxy is installed unpacked, so Chrome can't update it by itself: we only tell the user
// that a newer zip exists. Checked at most once a day, result cached in storage.

export interface UpdateInfo {
  current: string
  latest: string
  newer: boolean
  /** zip asset of the release (falls back to the release page) */
  downloadUrl: string
  pageUrl: string
}

const DAY = 864e5

export const repoUrl = () => chrome.runtime.getManifest().homepage_url as string | undefined

function cmp(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const repo = repoUrl()?.match(/github\.com\/([^/]+\/[^/#?]+)/)?.[1]
  if (!repo) return null
  const current = chrome.runtime.getManifest().version
  const { updateCheck } = await chrome.storage.local.get('updateCheck')
  if (!force && updateCheck && Date.now() - updateCheck.at < DAY) return { ...updateCheck.info, current, newer: cmp(updateCheck.info.latest, current) > 0 }

  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (r.status === 404) return null // no releases yet
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`)
  const rel = await r.json()
  const zip = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith('.zip'))
  const info = { latest: String(rel.tag_name).replace(/^v/, ''), downloadUrl: zip?.browser_download_url ?? rel.html_url, pageUrl: rel.html_url }
  await chrome.storage.local.set({ updateCheck: { at: Date.now(), info } })
  return { ...info, current, newer: cmp(info.latest, current) > 0 }
}
