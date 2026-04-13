import { PlistUID, type PlistValue } from './types'

export function isNSKeyedArchive(v: PlistValue): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  if (v instanceof PlistUID) return false
  if (v instanceof Date) return false
  const o = v as { [k: string]: PlistValue }
  return (
    o['$archiver'] === 'NSKeyedArchiver' &&
    typeof o['$version'] !== 'undefined' &&
    Array.isArray(o['$objects']) &&
    !!o['$top']
  )
}

/**
 * 把 NSKeyedArchive 顶层结构解包成正常的 JS 对象树。
 * 非 NSKeyedArchive 原样返回。
 */
export function unwrapNSKeyedArchive(root: PlistValue): PlistValue {
  if (!isNSKeyedArchive(root)) return root
  const o = root as { [k: string]: PlistValue }
  const objects = o['$objects'] as PlistValue[]
  const top = o['$top'] as { [k: string]: PlistValue }

  const memo = new Map<number, PlistValue>()
  const visiting = new Set<number>()

  const resolveRef = (ref: PlistValue): PlistValue => {
    if (!(ref instanceof PlistUID)) return ref
    const idx = ref.value
    if (memo.has(idx)) return memo.get(idx)!
    if (visiting.has(idx)) {
      // 循环引用：返回占位
      return { __circular_uid: idx }
    }
    visiting.add(idx)
    try {
      const raw = objects[idx]
      const resolved = resolveValue(raw)
      memo.set(idx, resolved)
      return resolved
    } finally {
      visiting.delete(idx)
    }
  }

  const resolveValue = (raw: PlistValue): PlistValue => {
    // "$null" 占位代表 null
    if (raw === '$null') return null
    if (raw instanceof PlistUID) return resolveRef(raw)
    if (Array.isArray(raw)) return raw.map(resolveValue)
    if (raw && typeof raw === 'object' && !(raw instanceof Date)) {
      const dict = raw as { [k: string]: PlistValue }
      // 带 $class 的：根据 classname 展开
      if (dict['$class'] instanceof PlistUID) {
        const classInfo = resolveRef(dict['$class'])
        const classname = extractClassname(classInfo)
        return unwrapClass(classname, dict, resolveValue)
      }
      // 普通 dict：递归展开
      const out: { [k: string]: PlistValue } = {}
      for (const [k, v] of Object.entries(dict)) out[k] = resolveValue(v)
      return out
    }
    return raw
  }

  // $top 可能是 { root: UID } 或包含多个键
  const topKeys = Object.keys(top)
  if (topKeys.length === 1) {
    return resolveValue(top[topKeys[0]])
  }
  const result: { [k: string]: PlistValue } = {}
  for (const k of topKeys) result[k] = resolveValue(top[k])
  return result
}

function extractClassname(info: PlistValue): string {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return ''
  if (info instanceof Date || info instanceof PlistUID) return ''
  const cn = (info as { [k: string]: PlistValue })['$classname']
  return typeof cn === 'string' ? cn : ''
}

function unwrapClass(
  classname: string,
  dict: { [k: string]: PlistValue },
  resolve: (v: PlistValue) => PlistValue
): PlistValue {
  switch (classname) {
    case 'NSString':
    case 'NSMutableString': {
      const s = dict['NS.string']
      return typeof s === 'string' ? s : s ?? ''
    }
    case 'NSNumber':
    case 'NSDecimalNumber': {
      const intv = dict['NS.intval']
      const dblv = dict['NS.dblval']
      if (typeof intv !== 'undefined') return resolve(intv)
      if (typeof dblv !== 'undefined') return resolve(dblv)
      return null
    }
    case 'NSDate': {
      const t = dict['NS.time']
      if (typeof t === 'number') {
        return new Date(Date.UTC(2001, 0, 1) + t * 1000)
      }
      return resolve(t)
    }
    case 'NSData':
    case 'NSMutableData':
      return resolve(dict['NS.data'])
    case 'NSArray':
    case 'NSMutableArray':
    case 'NSSet':
    case 'NSMutableSet':
    case 'NSOrderedSet':
    case 'NSMutableOrderedSet': {
      const items = dict['NS.objects']
      if (!Array.isArray(items)) return []
      return items.map(resolve)
    }
    case 'NSDictionary':
    case 'NSMutableDictionary': {
      const keys = dict['NS.keys']
      const values = dict['NS.objects']
      if (!Array.isArray(keys) || !Array.isArray(values)) return {}
      const out: { [k: string]: PlistValue } = {}
      for (let i = 0; i < keys.length; i++) {
        const k = resolve(keys[i])
        out[typeof k === 'string' ? k : String(k)] = resolve(values[i])
      }
      return out
    }
    case 'NSURL': {
      const rel = dict['NS.relative']
      return typeof rel === 'string' ? rel : resolve(rel)
    }
    case 'NSUUID': {
      const b = dict['NS.uuidbytes']
      if (b && typeof b === 'object' && 'bytes' in (b as object)) {
        const bytes = (b as { bytes: Uint8Array }).bytes
        return formatUUID(bytes)
      }
      return resolve(b)
    }
    default: {
      // 未知 class：保留结构，把 $class 替换成 classname 以便阅读
      const out: { [k: string]: PlistValue } = { __class: classname }
      for (const [k, v] of Object.entries(dict)) {
        if (k === '$class') continue
        out[k] = resolve(v)
      }
      return out
    }
  }
}

function formatUUID(b: Uint8Array): string {
  if (b.length !== 16) return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
