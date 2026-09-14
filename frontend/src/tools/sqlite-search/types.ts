import type { sqlitex } from '../../../wailsjs/go/models'

export type Cell = sqlitex.Cell
export type Hit = sqlitex.Hit
export type Table = sqlitex.Table

/** 一个格子怎么显示。NULL 和空字符串是两回事,取证里这个区别有意义 */
export function cellText(c: Cell): string {
  if (c.null) return 'NULL'
  return c.text
}

/**
 * 把一段文本按关键词切成片段,命中的那段单独标出来。
 *
 * 自己切而不是用 dangerouslySetInnerHTML:命中的内容来自证据文件,
 * 里面完全可能有 <script> 或者别的标记 —— 直接当 HTML 塞进去
 * 就是把证据内容当代码执行
 */
export function highlight(text: string, keyword: string): { s: string; hit: boolean }[] {
  if (!keyword) return [{ s: text, hit: false }]
  const lowText = text.toLowerCase()
  const lowKey = keyword.toLowerCase()
  const out: { s: string; hit: boolean }[] = []
  let i = 0
  for (;;) {
    const at = lowText.indexOf(lowKey, i)
    if (at < 0) break
    if (at > i) out.push({ s: text.slice(i, at), hit: false })
    out.push({ s: text.slice(at, at + keyword.length), hit: true })
    i = at + keyword.length
  }
  if (i < text.length) out.push({ s: text.slice(i), hit: false })
  return out.length > 0 ? out : [{ s: text, hit: false }]
}

/** 一行里哪一列命中了 */
export function hitIndex(h: Hit): number {
  return h.columns.indexOf(h.column)
}

/** 把关键词文本切成一串。逗号、分号、换行都算分隔符 */
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,;\r\n]+/)) {
    const t = part.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 命中按库分组,一个库下面可能有好几张表都命中 */
export function groupByFile(hits: Hit[]): { file: string; hits: Hit[] }[] {
  const map = new Map<string, Hit[]>()
  for (const h of hits) {
    const list = map.get(h.file)
    if (list) list.push(h)
    else map.set(h.file, [h])
  }
  return Array.from(map, ([file, list]) => ({ file, hits: list }))
}
