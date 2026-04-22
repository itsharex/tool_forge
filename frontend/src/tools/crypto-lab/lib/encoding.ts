export type DataEncoding = 'utf8' | 'hex' | 'base64'

export function toBytes(input: string, enc: DataEncoding): Uint8Array {
  if (!input) return new Uint8Array(0)
  if (enc === 'utf8') return new TextEncoder().encode(input)
  if (enc === 'hex') return hexToBytes(input)
  if (enc === 'base64') return base64ToBytes(input)
  throw new Error('未知编码')
}

export function fromBytes(bytes: Uint8Array, enc: DataEncoding): string {
  if (enc === 'utf8') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
  if (enc === 'hex') return bytesToHex(bytes)
  if (enc === 'base64') return bytesToBase64(bytes)
  throw new Error('未知编码')
}

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.replace(/[\s:]/g, '')
  if (s.length % 2 !== 0) throw new Error('hex 长度必须为偶数')
  if (!/^[0-9a-f]*$/i.test(s)) throw new Error('hex 含非法字符')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '')
  try {
    const bin = atob(clean)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch (e) {
    throw new Error('base64 解析失败')
  }
}

export function bytesToBase64(b: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < b.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(b.subarray(i, i + CHUNK)) as any,
    )
  }
  return btoa(bin)
}

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}
