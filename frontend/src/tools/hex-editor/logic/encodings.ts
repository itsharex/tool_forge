export type EncodingId =
  | 'ascii'
  | 'latin1'
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'gbk'

export const ENCODINGS: { id: EncodingId; label: string }[] = [
  { id: 'ascii', label: 'ASCII' },
  { id: 'latin1', label: 'Latin-1' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'gbk', label: 'GBK' },
]

/**
 * 将一行字节按指定编码解码成显示用字符串。
 * 单字节编码保证 1 byte → 1 char，多字节编码中不可打印字符用 "." 替换。
 */
export function decodeRow(bytes: Uint8Array, enc: EncodingId): string {
  if (enc === 'ascii') {
    let s = ''
    for (const b of bytes) s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    return s
  }
  if (enc === 'latin1') {
    let s = ''
    for (const b of bytes) {
      if (b < 0x20 || b === 0x7f) s += '.'
      else s += String.fromCharCode(b)
    }
    return s
  }
  try {
    const dec = new TextDecoder(enc, { fatal: false, ignoreBOM: true })
    const raw = dec.decode(bytes)
    let s = ''
    for (const ch of raw) {
      const code = ch.codePointAt(0) ?? 0
      s += code >= 0x20 && code !== 0x7f ? ch : '.'
    }
    return s
  } catch {
    return '.'.repeat(bytes.length)
  }
}
