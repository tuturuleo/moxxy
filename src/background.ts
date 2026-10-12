// Toolbar icon / Alt+B: focus an already open Moxxy tab or open a new one.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html')
  const [tab] = await chrome.tabs.query({ url })
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url })
  }
})
