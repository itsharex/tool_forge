import { PlistData, PlistUID, type PlistValue } from './types'

/**
 * 解析 Apple bplist00 二进制 plist。
 * 规范参考：https://opensource.apple.com/source/CF/CF-1153.18/CFBinaryPList.c
 */
export function parseBinaryPlist(buf: ArrayBuffer | Uint8Array): PlistValue {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8.length < 8 + 32) throw new Error('bplist 文件过小')

  const magic = String.fromCharCode(...u8.subarray(0, 6))
  if (magic !== 'bplist') throw new Error('不是 bplist（魔数不符）')
  const version = String.fromCharCode(u8[6], u8[7])
  if (version !== '00') {
    // bplist15/16 是 Apple 用于 CFKeyedArchive 的内部格式，结构完全不同
    throw new Error(`暂不支持 bplist${version}（仅支持 bplist00）`)
  }

  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const trailerOffset = u8.length - 32
  const offsetSize = u8[trailerOffset + 6]
  const objectRefSize = u8[trailerOffset + 7]
  const numObjects = Number(readUIntBE(u8, trailerOffset + 8, 8))
  const topObject = Number(readUIntBE(u8, trailerOffset + 16, 8))
  const offsetTableOffset = Number(readUIntBE(u8, trailerOffset + 24, 8))

  if (numObjects <= 0 || numObjects > 1e7) {
    throw new Error(`numObjects 异常: ${numObjects}`)
  }

  const offsets: number[] = new Array(numObjects)
  for (let i = 0; i < numObjects; i++) {
    offsets[i] = Number(readUIntBE(u8, offsetTableOffset + i * offsetSize, offsetSize))
  }

  const cache: (PlistValue | undefined)[] = new Array(numObjects)
  const visiting = new Set<number>()

  const readObjectRef = (pos: number): number =>
    Number(readUIntBE(u8, pos, objectRefSize))

  const readLength = (pos: number, lo: number): { length: number; skip: number } => {
    if (lo < 0x0f) return { length: lo, skip: 0 }
    const intMarker = u8[pos + 1]
    if ((intMarker >> 4) !== 0x1) throw new Error('长度扩展标记不是 integer')
    const intBytes = 1 << (intMarker & 0x0f)
    const length = Number(readUIntBE(u8, pos + 2, intBytes))
    return { length, skip: 1 + intBytes }
  }

  const readObject = (idx: number): PlistValue => {
    if (cache[idx] !== undefined) return cache[idx] as PlistValue
    if (visiting.has(idx)) throw new Error(`bplist 存在循环引用 (obj#${idx})`)
    visiting.add(idx)
    try {
      const pos = offsets[idx]
      if (pos == null || pos >= u8.length) throw new Error(`obj#${idx} 偏移越界`)
      const marker = u8[pos]
      const hi = marker >> 4
      const lo = marker & 0x0f
      let result: PlistValue

      switch (hi) {
        case 0x0: {
          if (marker === 0x00) result = null
          else if (marker === 0x08) result = false
          else if (marker === 0x09) result = true
          else if (marker === 0x0f) result = null
          else throw new Error(`未知 0x0n 标记: 0x${marker.toString(16)}`)
          break
        }
        case 0x1: {
          const nBytes = 1 << lo
          if (nBytes <= 4) {
            result = Number(readUIntBE(u8, pos + 1, nBytes))
          } else if (nBytes === 8) {
            const big = dv.getBigInt64(pos + 1, false)
            result =
              big >= BigInt(Number.MIN_SAFE_INTEGER) &&
              big <= BigInt(Number.MAX_SAFE_INTEGER)
                ? Number(big)
                : big
          } else if (nBytes === 16) {
            let big = 0n
            for (let i = 0; i < 16; i++) big = (big << 8n) | BigInt(u8[pos + 1 + i])
            if (u8[pos + 1] & 0x80) big -= 1n << 128n
            result = big
          } else {
            throw new Error(`未知 integer 长度 ${nBytes}`)
          }
          break
        }
        case 0x2: {
          const nBytes = 1 << lo
          if (nBytes === 4) result = dv.getFloat32(pos + 1, false)
          else if (nBytes === 8) result = dv.getFloat64(pos + 1, false)
          else throw new Error(`未知 real 长度 ${nBytes}`)
          break
        }
        case 0x3: {
          if (marker !== 0x33) throw new Error(`未知 date 标记 0x${marker.toString(16)}`)
          const seconds = dv.getFloat64(pos + 1, false)
          result = new Date(Date.UTC(2001, 0, 1) + seconds * 1000)
          break
        }
        case 0x4: {
          const { length, skip } = readLength(pos, lo)
          const start = pos + 1 + skip
          result = new PlistData(u8.slice(start, start + length))
          break
        }
        case 0x5: {
          const { length, skip } = readLength(pos, lo)
          const start = pos + 1 + skip
          result = new TextDecoder('ascii').decode(u8.subarray(start, start + length))
          break
        }
        case 0x6: {
          const { length, skip } = readLength(pos, lo)
          const start = pos + 1 + skip
          result = new TextDecoder('utf-16be').decode(
            u8.subarray(start, start + length * 2)
          )
          break
        }
        case 0x7: {
          const { length, skip } = readLength(pos, lo)
          const start = pos + 1 + skip
          result = new TextDecoder('utf-8').decode(u8.subarray(start, start + length))
          break
        }
        case 0x8: {
          const n = lo + 1
          result = new PlistUID(Number(readUIntBE(u8, pos + 1, n)))
          break
        }
        case 0xa:
        case 0xb:
        case 0xc: {
          const { length, skip } = readLength(pos, lo)
          const start = pos + 1 + skip
          const arr: PlistValue[] = new Array(length)
          for (let i = 0; i < length; i++) {
            arr[i] = readObject(readObjectRef(start + i * objectRefSize))
          }
          result = arr
          break
        }
        case 0xd: {
          const { length, skip } = readLength(pos, lo)
          const keyStart = pos + 1 + skip
          const valStart = keyStart + length * objectRefSize
          const obj: { [k: string]: PlistValue } = {}
          for (let i = 0; i < length; i++) {
            const keyRef = readObjectRef(keyStart + i * objectRefSize)
            const valRef = readObjectRef(valStart + i * objectRefSize)
            const key = readObject(keyRef)
            obj[typeof key === 'string' ? key : String(key)] = readObject(valRef)
          }
          result = obj
          break
        }
        default:
          throw new Error(`未知 bplist marker: 0x${marker.toString(16).padStart(2, '0')}`)
      }

      cache[idx] = result
      return result
    } finally {
      visiting.delete(idx)
    }
  }

  return readObject(topObject)
}

function readUIntBE(u8: Uint8Array, offset: number, size: number): number | bigint {
  if (size <= 0) return 0
  if (size === 1) return u8[offset]
  if (size === 2) return (u8[offset] << 8) | u8[offset + 1]
  if (size === 3) return (u8[offset] << 16) | (u8[offset + 1] << 8) | u8[offset + 2]
  if (size === 4) {
    return (
      u8[offset] * 0x1000000 +
      ((u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3])
    )
  }
  let big = 0n
  for (let i = 0; i < size; i++) big = (big << 8n) | BigInt(u8[offset + i])
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big
}
