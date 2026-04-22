// 国密 SM2 / SM4：使用 sm-crypto（纯 JS）。
// 注意：sm-crypto 只接受 hex 字符串；我们在外层做 bytes ↔ hex 转换
import smCrypto from 'sm-crypto'
import { bytesToHex, hexToBytes } from './encoding'

const { sm2, sm4 } = smCrypto as any

// ---------- SM2 ----------

/** 生成 SM2 密钥对（hex 字符串，公钥包含 04 前缀的 65 字节压缩前格式） */
export function sm2GenerateKeyPair(): { publicKey: string; privateKey: string } {
  const kp = sm2.generateKeyPairHex()
  return { publicKey: kp.publicKey, privateKey: kp.privateKey }
}

/**
 * @param mode 密文格式：C1C3C2（国密推荐，默认）或 C1C2C3
 */
export function sm2Encrypt(
  publicKeyHex: string,
  plain: Uint8Array,
  mode: 'C1C3C2' | 'C1C2C3' = 'C1C3C2',
): Uint8Array {
  const cipherMode = mode === 'C1C3C2' ? 1 : 0
  // sm-crypto 接受 string 或 bytes array；我们传 Array 保兼容
  const hex: string = sm2.doEncrypt(
    Array.from(plain),
    normalizePublicKey(publicKeyHex),
    cipherMode,
  )
  return hexToBytes(hex)
}

export function sm2Decrypt(
  privateKeyHex: string,
  cipher: Uint8Array,
  mode: 'C1C3C2' | 'C1C2C3' = 'C1C3C2',
): Uint8Array {
  const cipherMode = mode === 'C1C3C2' ? 1 : 0
  // sm-crypto 返回值：如传 output='array' 则返回字节数组
  const hex = bytesToHex(cipher)
  const arr: number[] = sm2.doDecrypt(hex, privateKeyHex, cipherMode, {
    output: 'array',
  })
  return new Uint8Array(arr)
}

export function sm2Sign(
  privateKeyHex: string,
  msg: Uint8Array,
  options?: { der?: boolean; hash?: boolean; publicKey?: string; userId?: string },
): string {
  const opts: any = {
    der: options?.der ?? false,
    hash: options?.hash ?? true, // 默认使用 SM3 预哈希
  }
  if (options?.publicKey) opts.publicKey = normalizePublicKey(options.publicKey)
  if (options?.userId) opts.userId = options.userId
  return sm2.doSignature(Array.from(msg), privateKeyHex, opts)
}

export function sm2Verify(
  publicKeyHex: string,
  msg: Uint8Array,
  sigHex: string,
  options?: { der?: boolean; hash?: boolean; userId?: string },
): boolean {
  const opts: any = {
    der: options?.der ?? false,
    hash: options?.hash ?? true,
  }
  if (options?.userId) opts.userId = options.userId
  return sm2.doVerifySignature(
    Array.from(msg),
    sigHex,
    normalizePublicKey(publicKeyHex),
    opts,
  )
}

function normalizePublicKey(pub: string): string {
  const s = pub.trim().toLowerCase()
  // 如果是 128 字符（裸 x||y），加 04 前缀
  if (s.length === 128 && /^[0-9a-f]+$/.test(s)) return '04' + s
  return s
}

// ---------- SM4 ----------

export type Sm4Mode = 'ecb' | 'cbc'

export function sm4Encrypt(
  keyBytes: Uint8Array,
  plain: Uint8Array,
  mode: Sm4Mode,
  iv?: Uint8Array,
): Uint8Array {
  if (keyBytes.length !== 16) throw new Error('SM4 密钥必须 128 位（16 字节）')
  const opts: any = { mode }
  if (mode === 'cbc') {
    if (!iv || iv.length !== 16) throw new Error('SM4-CBC IV 必须 16 字节')
    opts.iv = bytesToHex(iv)
  }
  // sm-crypto: encrypt(plainBytes, keyHex, options) → hex
  const hex: string = sm4.encrypt(Array.from(plain), bytesToHex(keyBytes), opts)
  return hexToBytes(hex)
}

export function sm4Decrypt(
  keyBytes: Uint8Array,
  cipher: Uint8Array,
  mode: Sm4Mode,
  iv?: Uint8Array,
): Uint8Array {
  if (keyBytes.length !== 16) throw new Error('SM4 密钥必须 128 位（16 字节）')
  const opts: any = { mode, output: 'array' }
  if (mode === 'cbc') {
    if (!iv || iv.length !== 16) throw new Error('SM4-CBC IV 必须 16 字节')
    opts.iv = bytesToHex(iv)
  }
  const arr: number[] = sm4.decrypt(bytesToHex(cipher), bytesToHex(keyBytes), opts)
  return new Uint8Array(arr)
}
