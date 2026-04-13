import CryptoJS from 'crypto-js'

/**
 * 用 AES-128-CFB 解密加密的 MMKV 文件。
 *
 * 格式约定：
 *   - 加密 MMKV 文件头 4 字节（size header）未加密
 *   - 剩余字节用 AES-128-CFB 加密
 *   - IV 来自配对的 .crc 文件的第 [12:28] 字节
 *   - AES key：hex 字符串，空位补 0x00，多余截断到前 16 字节
 */
export function decryptMMKV(
  encryptedFile: Uint8Array,
  crcFile: Uint8Array,
  keyHex: string
): Uint8Array {
  if (encryptedFile.length < 4) throw new Error('加密 MMKV 文件过小')
  if (crcFile.length < 28) {
    throw new Error(`.crc 文件过小（${crcFile.length} < 28 字节）`)
  }

  const iv = crcFile.subarray(12, 28)
  const key = parseKeyHex(keyHex)

  const sizeHeader = encryptedFile.subarray(0, 4)
  const cipherBytes = encryptedFile.subarray(4)

  const keyWA = u8ToWA(key)
  const ivWA = u8ToWA(iv)
  const ctWA = u8ToWA(cipherBytes)

  const decryptedWA = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: ctWA }),
    keyWA,
    {
      iv: ivWA,
      mode: CryptoJS.mode.CFB,
      padding: CryptoJS.pad.NoPadding,
    }
  )

  const decrypted = waToU8(decryptedWA)
  const out = new Uint8Array(4 + decrypted.length)
  out.set(sizeHeader, 0)
  out.set(decrypted, 4)
  return out
}

function parseKeyHex(keyHex: string): Uint8Array {
  const cleaned = keyHex.replace(/\s+/g, '')
  if (cleaned.length === 0) throw new Error('AES key 不能为空')
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('AES key 应为十六进制字符串')
  }
  if (cleaned.length % 2 !== 0) throw new Error('AES key hex 字符数应为偶数')
  const src = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < src.length; i++) {
    src[i] = parseInt(cleaned.substr(i * 2, 2), 16)
  }
  const out = new Uint8Array(16)
  out.set(src.subarray(0, Math.min(16, src.length)))
  return out
}

function u8ToWA(u8: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = []
  for (let i = 0; i < u8.length; i += 4) {
    const w =
      (u8[i] << 24) |
      ((u8[i + 1] ?? 0) << 16) |
      ((u8[i + 2] ?? 0) << 8) |
      (u8[i + 3] ?? 0)
    words.push(w | 0)
  }
  return CryptoJS.lib.WordArray.create(words, u8.length)
}

function waToU8(wa: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wa
  const out = new Uint8Array(sigBytes)
  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  }
  return out
}
