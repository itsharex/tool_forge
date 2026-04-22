// 轻量 cron 解析器（支持 5 或 6 字段）。
// 5 字段: 分 时 日 月 周
// 6 字段: 秒 分 时 日 月 周（Quartz 风格）
// 支持: * , - / JAN-DEC SUN-SAT @hourly @daily @weekly @monthly @yearly @annually

export interface FieldRange {
  min: number
  max: number
  values: Set<number> // 允许值集合
  star: boolean // 是否为完全通配
}

export interface ParsedCron {
  mode: 5 | 6
  second?: FieldRange
  minute: FieldRange
  hour: FieldRange
  dom: FieldRange // day of month
  month: FieldRange
  dow: FieldRange // day of week 0-6 (周日=0)
}

export interface ParseResult {
  parsed?: ParsedCron
  error?: string
  normalized: string // 规范化后的表达式（展开宏）
}

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const SHORTCUTS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

export function parseCron(input: string): ParseResult {
  const raw = input.trim()
  if (!raw) return { normalized: '', error: '空表达式' }

  let expr = raw
  const lower = raw.toLowerCase()
  if (SHORTCUTS[lower]) expr = SHORTCUTS[lower]

  const parts = expr.split(/\s+/)
  if (parts.length !== 5 && parts.length !== 6) {
    return {
      normalized: expr,
      error: `需要 5 或 6 个字段，当前 ${parts.length} 个`,
    }
  }

  try {
    if (parts.length === 5) {
      const minute = parseField(parts[0], 0, 59, 'minute')
      const hour = parseField(parts[1], 0, 23, 'hour')
      const dom = parseField(parts[2], 1, 31, 'dom')
      const month = parseField(parts[3], 1, 12, 'month', MONTHS, 1)
      const dow = parseField(parts[4], 0, 6, 'dow', DOWS, 0, (n) => (n === 7 ? 0 : n))
      return {
        normalized: expr,
        parsed: { mode: 5, minute, hour, dom, month, dow },
      }
    } else {
      const second = parseField(parts[0], 0, 59, 'second')
      const minute = parseField(parts[1], 0, 59, 'minute')
      const hour = parseField(parts[2], 0, 23, 'hour')
      const dom = parseField(parts[3], 1, 31, 'dom')
      const month = parseField(parts[4], 1, 12, 'month', MONTHS, 1)
      const dow = parseField(parts[5], 0, 6, 'dow', DOWS, 0, (n) => (n === 7 ? 0 : n))
      return {
        normalized: expr,
        parsed: { mode: 6, second, minute, hour, dom, month, dow },
      }
    }
  } catch (e: any) {
    return { normalized: expr, error: e?.message ?? String(e) }
  }
}

function parseField(
  raw: string,
  min: number,
  max: number,
  name: string,
  aliases?: string[],
  aliasOffset = 0,
  normalize?: (n: number) => number,
): FieldRange {
  // 允许 ? 等同 *（Quartz 风格）
  const field = raw === '?' ? '*' : raw
  const values = new Set<number>()
  let star = false

  for (const piece of field.split(',')) {
    parsePiece(piece)
  }

  function parsePiece(p: string) {
    let step = 1
    let rest = p

    const slash = p.indexOf('/')
    if (slash >= 0) {
      step = parseInt(p.slice(slash + 1), 10)
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`${name}: 非法步长 "${p}"`)
      }
      rest = p.slice(0, slash) || '*'
    }

    let a: number
    let b: number
    if (rest === '*') {
      a = min
      b = max
      if (step === 1) star = true
    } else if (rest.includes('-')) {
      const [ra, rb] = rest.split('-')
      a = toNumber(ra)
      b = toNumber(rb)
      if (a > b) throw new Error(`${name}: 区间反转 "${p}"`)
    } else {
      a = toNumber(rest)
      b = a
    }

    for (let v = a; v <= b; v += step) {
      const n = normalize ? normalize(v) : v
      if (n < min || n > max) {
        // normalize 后越界（如 dow 7 → 0），忽略
        continue
      }
      values.add(n)
    }
  }

  function toNumber(s: string): number {
    const t = s.trim().toUpperCase()
    if (aliases) {
      const i = aliases.indexOf(t)
      if (i >= 0) return i + aliasOffset
    }
    const n = parseInt(t, 10)
    if (!Number.isFinite(n)) throw new Error(`${name}: 非法值 "${s}"`)
    if (n < min || n > (max + (name === 'dow' ? 1 : 0))) {
      // dow 允许 7 作为周日
      if (!(name === 'dow' && n === 7))
        throw new Error(`${name}: ${n} 超出 [${min}, ${max}]`)
    }
    return n
  }

  if (values.size === 0) {
    throw new Error(`${name}: 无有效值`)
  }
  return { min, max, values, star }
}

// ----------- 下一个匹配时刻 -----------

function match(d: Date, p: ParsedCron): boolean {
  if (!p.month.values.has(d.getMonth() + 1)) return false
  if (!p.hour.values.has(d.getHours())) return false
  if (!p.minute.values.has(d.getMinutes())) return false
  if (p.second && !p.second.values.has(d.getSeconds())) return false
  // dom + dow: 标准 Vixie cron 规则
  // 两者都受限时，日期满足其一即可；仅一方受限时两者都必须满足
  const domRestricted = !p.dom.star
  const dowRestricted = !p.dow.star
  const okDom = p.dom.values.has(d.getDate())
  const okDow = p.dow.values.has(d.getDay())
  if (domRestricted && dowRestricted) {
    if (!okDom && !okDow) return false
  } else {
    if (!okDom || !okDow) return false
  }
  return true
}

/** 从 `from`（含）开始，返回下 `count` 个匹配时刻。最多迭代 366 天。 */
export function nextFireTimes(
  p: ParsedCron,
  from: Date,
  count: number,
): Date[] {
  const out: Date[] = []
  const t = new Date(from.getTime())
  // 对齐到下一个合法起点
  if (p.mode === 5) {
    t.setSeconds(0, 0)
    t.setMinutes(t.getMinutes() + 1) // 从下一分钟开始
  } else {
    t.setMilliseconds(0)
    t.setSeconds(t.getSeconds() + 1)
  }

  const stepMs = p.mode === 5 ? 60 * 1000 : 1000
  const maxIter = p.mode === 5 ? 366 * 24 * 60 : 366 * 24 * 60 * 60 // 一年
  for (let i = 0; i < maxIter && out.length < count; i++) {
    if (match(t, p)) {
      out.push(new Date(t.getTime()))
    }
    t.setTime(t.getTime() + stepMs)
  }
  return out
}

// ----------- 人类可读描述 -----------

export function describe(p: ParsedCron): string {
  const parts: string[] = []

  parts.push(describeMonthDay(p))
  parts.push(describeTime(p))

  return parts.filter(Boolean).join('，')
}

function describeTime(p: ParsedCron): string {
  const secDesc = p.second ? describeSecond(p.second) : ''
  const minDesc = describeMinute(p.minute)
  const hrDesc = describeHour(p.hour)

  // 简化典型模式
  if (p.minute.star && p.hour.star && (!p.second || p.second.star)) {
    return p.second ? '每秒' : '每分钟'
  }
  if (p.hour.star && p.minute.values.size === 1 && p.minute.values.has(0)) {
    return p.second && !p.second.star
      ? `每小时的第 0 分（秒：${secDesc}）`
      : '每小时整点'
  }
  if (p.hour.star) {
    if (p.minute.star) return p.second ? `每秒（${secDesc}）` : '每分钟'
    return `每小时的 ${minDesc} 分${p.second && !p.second.star ? ` ${secDesc}` : ''}`
  }

  const timeStr =
    p.second && !p.second.star
      ? `${hrDesc}:${minDesc}:${secDesc}`
      : `${hrDesc}:${minDesc}`
  return `在 ${timeStr}`
}

function describeSecond(f: FieldRange): string {
  if (f.star) return '每秒'
  return listify(f, 's')
}
function describeMinute(f: FieldRange): string {
  if (f.star) return '**'
  return listify(f, 'm')
}
function describeHour(f: FieldRange): string {
  if (f.star) return '**'
  return listify(f, 'h')
}

function listify(f: FieldRange, _suffix: string): string {
  const arr = Array.from(f.values).sort((a, b) => a - b)
  if (arr.length === 1) return pad2(arr[0])
  if (arr.length <= 4) return arr.map(pad2).join(',')
  return arr.map(pad2).join(',')
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function describeMonthDay(p: ParsedCron): string {
  const segs: string[] = []
  if (!p.month.star) {
    const arr = Array.from(p.month.values).sort((a, b) => a - b)
    segs.push(arr.length === 12 ? '' : `${arr.join(',')} 月`)
  }
  const domRestricted = !p.dom.star
  const dowRestricted = !p.dow.star
  if (domRestricted && dowRestricted) {
    segs.push(`${formatDom(p.dom)} 日 或 ${formatDow(p.dow)}`)
  } else if (domRestricted) {
    segs.push(`${formatDom(p.dom)} 日`)
  } else if (dowRestricted) {
    segs.push(formatDow(p.dow))
  }
  return segs.filter(Boolean).join(' ')
}

function formatDom(f: FieldRange): string {
  const arr = Array.from(f.values).sort((a, b) => a - b)
  if (arr.length > 8) return '多日'
  return arr.join(',')
}

const DOW_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function formatDow(f: FieldRange): string {
  const arr = Array.from(f.values).sort((a, b) => a - b)
  return arr.map((n) => DOW_ZH[n]).join('、')
}

// ----------- 预设表达式 -----------
export const PRESETS: Array<{ expr: string; name: string }> = [
  { expr: '* * * * *', name: '每分钟' },
  { expr: '0 * * * *', name: '每小时整点' },
  { expr: '*/5 * * * *', name: '每 5 分钟' },
  { expr: '0 0 * * *', name: '每天 0 点' },
  { expr: '30 9 * * 1-5', name: '工作日 9:30' },
  { expr: '0 0 * * 0', name: '每周日 0 点' },
  { expr: '0 0 1 * *', name: '每月 1 号 0 点' },
  { expr: '0 0 1 1 *', name: '每年 1 月 1 号 0 点' },
  { expr: '*/30 * * * *', name: '每半小时' },
  { expr: '@hourly', name: '@hourly' },
  { expr: '@daily', name: '@daily' },
  { expr: '@weekly', name: '@weekly' },
]
