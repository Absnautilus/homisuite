// Picks readable badge text (black or white) from a background color, so an
// admin choosing a shift code's badge color never has to also reason about
// contrast: computes the WCAG contrast ratio of each candidate against the
// background and returns whichever wins, rather than a single luminance
// cutoff -- the textbook-correct method, and the only one that resolves a
// close case like a mid-saturation purple correctly (a fixed threshold
// picks by which side of an arbitrary line the background falls on, not by
// which text color is actually more readable).
function relativeLuminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastTextColor(backgroundHex: string): '#111111' | '#ffffff' {
  const hex = backgroundHex.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#111111'
  const backgroundLuminance = relativeLuminance(full)
  const withWhite = contrastRatio(backgroundLuminance, 1)
  const withBlack = contrastRatio(backgroundLuminance, 0)
  return withBlack >= withWhite ? '#111111' : '#ffffff'
}
