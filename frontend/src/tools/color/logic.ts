export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

export function parseHex(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '')
  const normalized =
    raw.length === 3
      ? raw.split('').map((c) => c + c).join('')
      : raw.length === 6
      ? raw
      : null
  if (!normalized || !/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('无效的 HEX 值')
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

export function parseRgb(input: string): Rgb {
  const match = input.trim().match(/^rgba?\(\s*([^)]+)\)$/i)
  const body = match ? match[1] : input
  const parts = body.split(/[,\s]+/).filter(Boolean).slice(0, 3)
  if (parts.length !== 3) throw new Error('RGB 需要三个分量')
  const nums = parts.map((p) => {
    const n = Number(p)
    if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error('分量必须是 0-255')
    return Math.round(n)
  })
  return { r: nums[0], g: nums[1], b: nums[2] }
}

export function parseHsl(input: string): Rgb {
  const match = input.trim().match(/^hsla?\(\s*([^)]+)\)$/i)
  const body = match ? match[1] : input
  const parts = body.split(/[,\s]+/).filter(Boolean).slice(0, 3)
  if (parts.length !== 3) throw new Error('HSL 需要三个分量')
  const h = Number(parts[0].replace(/deg$/i, ''))
  const s = Number(parts[1].replace(/%$/, ''))
  const l = Number(parts[2].replace(/%$/, ''))
  if (![h, s, l].every(Number.isFinite)) throw new Error('无效的 HSL 值')
  return hslToRgb({ h: ((h % 360) + 360) % 360, s, l })
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
        break
      case gn:
        h = ((bn - rn) / d + 2) * 60
        break
      case bn:
        h = ((rn - gn) / d + 4) * 60
        break
    }
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`
}

export function formatHsl({ h, s, l }: Hsl): string {
  return `hsl(${h}, ${s}%, ${l}%)`
}
