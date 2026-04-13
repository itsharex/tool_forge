import { PlistData, PlistUID, type PlistValue } from './types'

/** 把 PlistValue 序列化成带缩进的 JSON 字符串，支持 Date/BigInt/PlistData/PlistUID。 */
export function toJson(value: PlistValue, indent = 2): string {
  return JSON.stringify(prepare(value), null, indent)
}

function prepare(v: any): any {
  if (v === null || v === undefined) return null
  if (v instanceof PlistUID) return { __uid: v.value }
  if (v instanceof PlistData) {
    return { __data: v.toBase64(), __size: v.bytes.length }
  }
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map(prepare)
  if (typeof v === 'object') {
    const out: { [k: string]: any } = {}
    for (const [k, val] of Object.entries(v)) out[k] = prepare(val)
    return out
  }
  return String(v)
}
