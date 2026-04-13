import { PlistData, PlistUID, base64ToUint8, type PlistValue } from './types'

export function parseXmlPlist(xml: string): PlistValue {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const perr = doc.querySelector('parsererror')
  if (perr) throw new Error(perr.textContent?.trim() || 'XML 解析失败')
  const plist = doc.querySelector('plist')
  if (!plist) throw new Error('未找到 <plist> 根元素')
  const root = firstElementChild(plist)
  if (!root) throw new Error('<plist> 为空')
  return parseNode(root)
}

function firstElementChild(el: Element): Element | null {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 1) return n as Element
  }
  return null
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 1) as Element[]
}

function parseNode(n: Element): PlistValue {
  switch (n.tagName.toLowerCase()) {
    case 'dict': {
      const kids = elementChildren(n)
      const obj: { [k: string]: PlistValue } = {}
      for (let i = 0; i < kids.length; i += 2) {
        const keyEl = kids[i]
        const valEl = kids[i + 1]
        if (!keyEl || keyEl.tagName.toLowerCase() !== 'key') {
          throw new Error('<dict> 内 key/value 配对异常')
        }
        if (!valEl) throw new Error(`<key>${keyEl.textContent}</key> 缺少对应 value`)
        obj[keyEl.textContent ?? ''] = parseNode(valEl)
      }
      return obj
    }
    case 'array':
      return elementChildren(n).map(parseNode)
    case 'string':
      return n.textContent ?? ''
    case 'integer': {
      const s = (n.textContent ?? '').trim()
      // 可能超出 Number.MAX_SAFE_INTEGER，用 bigint 兜底
      const num = Number(s)
      if (!Number.isSafeInteger(num)) return BigInt(s)
      return num
    }
    case 'real':
      return parseFloat(n.textContent ?? '0')
    case 'true':
      return true
    case 'false':
      return false
    case 'date':
      return new Date((n.textContent ?? '').trim())
    case 'data':
      return new PlistData(base64ToUint8((n.textContent ?? '').trim()))
    case 'key':
      throw new Error('<key> 出现在非 dict 位置')
    default:
      throw new Error(`未知 plist 节点：<${n.tagName}>`)
  }
}

/** 把 PlistValue 序列化成 XML plist 字符串 */
export function toXmlPlist(value: PlistValue, indent = 2): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  )
  lines.push('<plist version="1.0">')
  emit(value, lines, 0, indent)
  lines.push('</plist>')
  return lines.join('\n')
}

function pad(level: number, indent: number): string {
  return ' '.repeat(level * indent)
}

function emit(v: PlistValue, out: string[], level: number, indent: number): void {
  const p = pad(level, indent)
  if (v === null || v === undefined) {
    out.push(`${p}<string></string>`)
    return
  }
  if (v instanceof PlistUID) {
    // NSKeyedArchive 的 UID 在 XML 中用 dict 表示
    out.push(`${p}<dict>`)
    out.push(`${pad(level + 1, indent)}<key>CF$UID</key>`)
    out.push(`${pad(level + 1, indent)}<integer>${v.value}</integer>`)
    out.push(`${p}</dict>`)
    return
  }
  if (v instanceof PlistData) {
    out.push(`${p}<data>${v.toBase64()}</data>`)
    return
  }
  if (v instanceof Date) {
    out.push(`${p}<date>${v.toISOString().replace(/\.\d{3}Z$/, 'Z')}</date>`)
    return
  }
  if (typeof v === 'boolean') {
    out.push(`${p}${v ? '<true/>' : '<false/>'}`)
    return
  }
  if (typeof v === 'bigint') {
    out.push(`${p}<integer>${v.toString()}</integer>`)
    return
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) out.push(`${p}<integer>${v}</integer>`)
    else out.push(`${p}<real>${v}</real>`)
    return
  }
  if (typeof v === 'string') {
    out.push(`${p}<string>${escapeXml(v)}</string>`)
    return
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      out.push(`${p}<array/>`)
      return
    }
    out.push(`${p}<array>`)
    for (const item of v) emit(item, out, level + 1, indent)
    out.push(`${p}</array>`)
    return
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as { [k: string]: PlistValue })
    if (entries.length === 0) {
      out.push(`${p}<dict/>`)
      return
    }
    out.push(`${p}<dict>`)
    for (const [k, val] of entries) {
      out.push(`${pad(level + 1, indent)}<key>${escapeXml(k)}</key>`)
      emit(val, out, level + 1, indent)
    }
    out.push(`${p}</dict>`)
    return
  }
  out.push(`${p}<string>${escapeXml(String(v))}</string>`)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
