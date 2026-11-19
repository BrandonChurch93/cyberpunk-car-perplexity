export const panelFamily = 'Panel Condensed'

export function loadPanelFont(): void {
  const url = new URL('assets/third-party/fonts/barlow-condensed/BarlowCondensed-Regular.ttf', document.baseURI)
  const face = new FontFace(panelFamily, `url(${url.href})`)
  face.load().then((f) => document.fonts.add(f)).catch(() => undefined)
}

export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(0)
  })
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
