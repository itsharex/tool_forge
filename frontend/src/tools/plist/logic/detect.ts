export type PlistFormat = 'xml' | 'binary' | 'unknown'

/** 探测 plist 格式。binary 以 "bplist" 开头（通常 bplist00），xml 含 <?xml 或 <plist */
export function detectFormat(input: Uint8Array | string): PlistFormat {
  if (typeof input === 'string') {
    const head = input.trimStart().slice(0, 64).toLowerCase()
    if (head.startsWith('<?xml') || head.startsWith('<plist')) return 'xml'
    return 'unknown'
  }
  if (input.length >= 8) {
    const magic = String.fromCharCode(
      input[0],
      input[1],
      input[2],
      input[3],
      input[4],
      input[5]
    )
    if (magic === 'bplist') return 'binary'
  }
  // UTF-8 文本尝试：看前面几个字节是不是可打印 ASCII
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(input.slice(0, 64))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<plist')) return 'xml'
  return 'unknown'
}
