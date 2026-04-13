export * from './types'
export * from './detect'
export * from './xml'
export * from './binary'
export * from './nskeyed'
export * from './json'

import { base64ToUint8, hexToUint8, type PlistValue } from './types'
import { detectFormat } from './detect'
import { parseXmlPlist } from './xml'
import { parseBinaryPlist } from './binary'

/** 根据输入自动判断格式并解析。输入可以是 XML 文本或原始字节。 */
export function parsePlist(input: Uint8Array | string): PlistValue {
  const fmt = detectFormat(input)
  if (fmt === 'binary') {
    return parseBinaryPlist(input as Uint8Array)
  }
  if (fmt === 'xml') {
    const xml = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
    return parseXmlPlist(xml)
  }
  throw new Error('无法识别的 plist 格式（既不是 XML 也不是 bplist00）')
}

export function parseFromBase64(s: string): PlistValue {
  return parsePlist(base64ToUint8(s))
}

export function parseFromHex(s: string): PlistValue {
  return parsePlist(hexToUint8(s))
}

export interface ParsedPlist {
  value: PlistValue
  /** 原始格式；binary 代表字节输入（可能本身来自 base64/hex 包装） */
  source: 'xml' | 'binary'
}

/**
 * 通用入口：自动判别 XML / 二进制 / base64 / hex 包装。
 * 优先顺序：字节魔数 → 文本 <?xml → base64 → hex
 */
export function parseAny(input: Uint8Array | string): ParsedPlist {
  if (typeof input !== 'string') {
    const fmt = detectFormat(input)
    if (fmt === 'binary') return { value: parseBinaryPlist(input), source: 'binary' }
    if (fmt === 'xml') {
      return {
        value: parseXmlPlist(new TextDecoder('utf-8').decode(input)),
        source: 'xml',
      }
    }
    // 字节内容既不是 bplist 也不是 XML —— 试着当文本再走一遍
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(input).trim()
    if (asText) return parseAny(asText)
    throw new Error('无法识别的 plist 格式')
  }

  const text = input.trim()
  if (!text) throw new Error('输入为空')

  if (detectFormat(text) === 'xml') {
    return { value: parseXmlPlist(text), source: 'xml' }
  }
  if (/^[A-Za-z0-9+/=\s\r\n]+$/.test(text)) {
    try {
      const bytes = base64ToUint8(text)
      const fmt = detectFormat(bytes)
      if (fmt === 'binary') return { value: parseBinaryPlist(bytes), source: 'binary' }
      if (fmt === 'xml') {
        return {
          value: parseXmlPlist(new TextDecoder('utf-8').decode(bytes)),
          source: 'xml',
        }
      }
    } catch {
      /* fallthrough */
    }
  }
  if (/^[0-9a-fA-F\s,]+$/.test(text)) {
    try {
      const bytes = hexToUint8(text)
      const fmt = detectFormat(bytes)
      if (fmt === 'binary') return { value: parseBinaryPlist(bytes), source: 'binary' }
    } catch {
      /* fallthrough */
    }
  }
  throw new Error('无法识别：既不是 XML 也不是 base64/hex 包装的 bplist')
}
