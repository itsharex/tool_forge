/** plist 中的 UID 类型（NSKeyedArchive 用到的对象引用） */
export class PlistUID {
  constructor(public readonly value: number) {}
  toJSON() {
    return { __uid: this.value }
  }
}

/** plist 中的 data 类型（任意二进制块）。JSON 序列化时转成 base64。 */
export class PlistData {
  constructor(public readonly bytes: Uint8Array) {}
  get size() {
    return this.bytes.length
  }
  toBase64(): string {
    return uint8ToBase64(this.bytes)
  }
  toJSON() {
    return { __data: this.toBase64(), __size: this.bytes.length }
  }
}

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | PlistData
  | PlistUID
  | PlistValue[]
  | { [key: string]: PlistValue }

export function uint8ToBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function hexToUint8(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length === 0) throw new Error('未识别到有效 hex 字符')
  if (cleaned.length % 2 !== 0) throw new Error('hex 字符数不是偶数')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.substr(i * 2, 2), 16)
  }
  return out
}
