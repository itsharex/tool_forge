/**
 * Protocol Buffers base-128 varint 编解码。
 * MMKV 使用和 protobuf 相同的 varint 规则存储长度和整型值。
 */

export interface VarintResult {
  value: number
  bytesRead: number
}

export interface VarintBigResult {
  value: bigint
  bytesRead: number
}

/** 读取一个 32 位无符号 varint，最多 5 字节；溢出位按 32-bit 截断。 */
export function readVarintU32(bytes: Uint8Array, offset: number): VarintResult {
  let result = 0
  let shift = 0
  let read = 0
  while (offset + read < bytes.length) {
    const b = bytes[offset + read]
    read++
    if (shift < 32) {
      result |= (b & 0x7f) << shift
    }
    shift += 7
    if ((b & 0x80) === 0) {
      return { value: result >>> 0, bytesRead: read }
    }
    if (read > 10) throw new Error('varint 过长')
  }
  throw new Error('varint 读到文件尾')
}

/** 读取一个 64 位无符号 varint，最多 10 字节。 */
export function readVarintU64(bytes: Uint8Array, offset: number): VarintBigResult {
  let result = 0n
  let shift = 0n
  let read = 0
  while (offset + read < bytes.length) {
    const b = bytes[offset + read]
    read++
    result |= BigInt(b & 0x7f) << shift
    shift += 7n
    if ((b & 0x80) === 0) {
      const mask = (1n << 64n) - 1n
      return { value: result & mask, bytesRead: read }
    }
    if (read > 10) throw new Error('varint 过长')
  }
  throw new Error('varint 读到文件尾')
}

/** 以 bits 位补码解释一个无符号 varint 为有符号整数。 */
export function readVarintSigned(
  bytes: Uint8Array,
  offset: number,
  bits: 32 | 64
): VarintResult | VarintBigResult {
  if (bits === 32) {
    const { value: u, bytesRead } = readVarintU32(bytes, offset)
    const signed = u >= 0x80000000 ? u - 0x100000000 : u
    return { value: signed, bytesRead }
  }
  const { value: u, bytesRead } = readVarintU64(bytes, offset)
  const signBit = 1n << 63n
  const signed = u & signBit ? u - (1n << 64n) : u
  return { value: signed, bytesRead }
}
