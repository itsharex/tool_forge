import { readVarintU32 } from './varint'

export interface MMKVEntry {
  key: string
  /** 历史值数组，newest-first */
  values: Uint8Array[]
}

export interface ParseResult {
  entries: MMKVEntry[]
  /** 文件声明的 dbSize（不含 header 之后的 padding） */
  dbSize: number
  /** 实际消费的字节数，用于校验 */
  consumed: number
  /** 被 MMKV 删除标记（value_len=0）的键数 */
  removedCount: number
}

/**
 * 解析 MMKV 文件（未加密）。
 *
 * 格式：
 *   [4B LE uint32 dbSize]
 *   [varint 未知用途]  // Tencent MMKV 源码未明确；实测是 0xffffff07 常见
 *   循环:
 *     [varint key_len] [utf8 key] [varint val_len] [raw val]
 *     val_len == 0 时表示该 key 被删除
 */
export function parseMMKV(bytes: Uint8Array): ParseResult {
  if (bytes.length < 4) throw new Error('文件过小，无法读取 MMKV 头部')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dbSizeRaw = dv.getUint32(0, true)

  let pos = 4
  // 跳过那个用途不明的 varint
  try {
    const { bytesRead } = readVarintU32(bytes, pos)
    pos += bytesRead
  } catch {
    throw new Error('解析 header 失败：无法读取 varint')
  }

  // dbSize 为 0 时（某些 MMKV 版本这么干），尽量读到文件尾
  const end =
    dbSizeRaw === 0 ? bytes.length : Math.min(dbSizeRaw, bytes.length)

  const map = new Map<string, Uint8Array[]>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let removedCount = 0

  while (pos < end) {
    // key length
    let keyLen: number
    let keyLenBytes: number
    try {
      ;({ value: keyLen, bytesRead: keyLenBytes } = readVarintU32(bytes, pos))
    } catch {
      break
    }
    pos += keyLenBytes
    if (keyLen === 0) {
      // 异常填充字节，跳过
      continue
    }
    if (pos + keyLen > bytes.length) break

    // key utf-8
    let key: string
    try {
      key = decoder.decode(bytes.subarray(pos, pos + keyLen))
    } catch {
      break
    }
    pos += keyLen

    // value length
    let valLen: number
    let valLenBytes: number
    try {
      ;({ value: valLen, bytesRead: valLenBytes } = readVarintU32(bytes, pos))
    } catch {
      break
    }
    pos += valLenBytes

    if (valLen === 0) {
      // 删除标记：key 本身仍存在于日志里，但代表被移除
      removedCount++
      continue
    }
    if (pos + valLen > bytes.length) break

    const valBytes = bytes.slice(pos, pos + valLen)
    pos += valLen

    const list = map.get(key) ?? []
    list.unshift(valBytes)
    map.set(key, list)
  }

  const entries = Array.from(map.entries()).map(([key, values]) => ({ key, values }))
  return { entries, dbSize: dbSizeRaw, consumed: pos, removedCount }
}
