export interface MatchInfo {
  index: number
  length: number
  full: string
  groups: Array<{ name?: string; value: string | undefined; index?: number }>
}

export interface CompileResult {
  regex?: RegExp
  error?: string
}

export function compile(pattern: string, flags: string): CompileResult {
  if (!pattern) return {}
  try {
    // 始终保留 g 标志，用于 matchAll / 全量匹配
    const f = flags.includes('g') ? flags : flags + 'g'
    // 为了取到 index 精确位置，加上 d 标志（有兼容性，出错时降级）
    let re: RegExp
    try {
      re = new RegExp(pattern, f + (f.includes('d') ? '' : 'd'))
    } catch {
      re = new RegExp(pattern, f)
    }
    return { regex: re }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}

export function findMatches(regex: RegExp, text: string, cap = 2000): MatchInfo[] {
  const out: MatchInfo[] = []
  if (!text) return out
  let m: RegExpExecArray | null
  let last = -1
  let count = 0
  // 用 exec 循环以获取 indices
  const re = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : regex.flags + 'g',
  )
  while ((m = re.exec(text)) !== null) {
    if (m.index === last && m[0].length === 0) {
      // 防止 zero-width 无限循环
      re.lastIndex++
      continue
    }
    last = m.index
    const groups: MatchInfo['groups'] = []
    const indices = (m as any).indices as Array<[number, number] | undefined> | undefined
    for (let i = 1; i < m.length; i++) {
      groups.push({
        value: m[i],
        index: indices?.[i]?.[0],
      })
    }
    if (m.groups) {
      for (const name of Object.keys(m.groups)) {
        groups.push({ name, value: m.groups[name] })
      }
    }
    out.push({
      index: m.index,
      length: m[0].length,
      full: m[0],
      groups,
    })
    count++
    if (count >= cap) break
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

export function replaceAll(regex: RegExp, text: string, replacement: string): string {
  if (!regex) return text
  const re = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : regex.flags + 'g',
  )
  return text.replace(re, replacement)
}

// ---- 本地片段库 ----
export interface Snippet {
  id: string
  name: string
  pattern: string
  flags: string
  note?: string
  createdAt: number
}

const LS_KEY = 'regex-tool:snippets'

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return v as Snippet[]
  } catch {
    // ignore
  }
  return []
}

export function saveSnippets(list: Snippet[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export const BUILTIN_PRESETS: Snippet[] = [
  {
    id: 'p-email',
    name: '邮箱',
    pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',
    flags: 'g',
    createdAt: 0,
  },
  {
    id: 'p-url',
    name: 'URL',
    pattern: 'https?://[\\w.-]+(?:/[\\w\\-./?%&=+~:#@]*)?',
    flags: 'gi',
    createdAt: 0,
  },
  {
    id: 'p-ipv4',
    name: 'IPv4',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    flags: 'g',
    createdAt: 0,
  },
  {
    id: 'p-uuid',
    name: 'UUID',
    pattern:
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    flags: 'gi',
    createdAt: 0,
  },
  {
    id: 'p-phone-cn',
    name: '中国手机号',
    pattern: '1[3-9]\\d{9}',
    flags: 'g',
    createdAt: 0,
  },
  {
    id: 'p-date-iso',
    name: 'ISO 日期',
    pattern: '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?',
    flags: 'g',
    createdAt: 0,
  },
  {
    id: 'p-hex-color',
    name: '十六进制颜色',
    pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b',
    flags: 'g',
    createdAt: 0,
  },
]
