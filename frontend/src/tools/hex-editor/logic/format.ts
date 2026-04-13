/** 把字节按指定进制格式化成定宽字符串 */
export type Radix = 'hex' | 'dec' | 'oct' | 'bin'

export function formatByte(b: number, radix: Radix): string {
  switch (radix) {
    case 'hex':
      return b.toString(16).padStart(2, '0').toUpperCase()
    case 'dec':
      return b.toString(10).padStart(3, ' ')
    case 'oct':
      return b.toString(8).padStart(3, '0')
    case 'bin':
      return b.toString(2).padStart(8, '0')
  }
}

export function radixCellWidth(radix: Radix): number {
  switch (radix) {
    case 'hex':
      return 2
    case 'dec':
      return 3
    case 'oct':
      return 3
    case 'bin':
      return 8
  }
}

export function formatOffset(off: number, total: number): string {
  // 长度根据文件大小自动选 8 / 10 / 12 位
  const width = total <= 0xffff_ffff ? 8 : 12
  return off.toString(16).padStart(width, '0').toUpperCase()
}

/** 解析十进制 / 0x 十六进制 / 0o 八进制 偏移字符串 */
export function parseOffset(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  let n: number
  if (s.startsWith('0x')) n = parseInt(s.slice(2), 16)
  else if (s.startsWith('0o')) n = parseInt(s.slice(2), 8)
  else if (s.startsWith('0b')) n = parseInt(s.slice(2), 2)
  else if (/^[0-9a-f]+h$/.test(s)) n = parseInt(s.slice(0, -1), 16)
  else n = parseInt(s, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
