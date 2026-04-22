import { concatBytes, randomBytes } from './encoding'

export type AesMode = 'GCM' | 'CBC'

// WebCrypto TypeScript 类型要求 BufferSource，而 Uint8Array<ArrayBufferLike> 无法直接通过；
// 统一用 any 绕过编译器分歧，运行时行为一致。
const anyArg = (x: any): any => x

async function importAesKey(keyBytes: Uint8Array, mode: AesMode): Promise<CryptoKey> {
  if (![16, 24, 32].includes(keyBytes.length)) {
    throw new Error(`AES 密钥必须为 128/192/256 位（当前 ${keyBytes.length * 8} 位）`)
  }
  const algo = mode === 'GCM' ? 'AES-GCM' : 'AES-CBC'
  return crypto.subtle.importKey('raw', anyArg(keyBytes), { name: algo }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function aesEncrypt(
  mode: AesMode,
  keyBytes: Uint8Array,
  plain: Uint8Array,
  iv?: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes, mode)
  const ivSize = mode === 'GCM' ? 12 : 16
  const actualIv = iv && iv.length > 0 ? iv : randomBytes(ivSize)
  if (actualIv.length !== ivSize) {
    throw new Error(`${mode} 的 IV 长度必须为 ${ivSize} 字节（当前 ${actualIv.length}）`)
  }
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      anyArg(
        mode === 'GCM'
          ? { name: 'AES-GCM', iv: actualIv }
          : { name: 'AES-CBC', iv: actualIv },
      ),
      key,
      anyArg(plain),
    ),
  )
  return concatBytes(actualIv, ct)
}

export async function aesDecrypt(
  mode: AesMode,
  keyBytes: Uint8Array,
  cipherWithIv: Uint8Array,
  ivOverride?: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes, mode)
  const ivSize = mode === 'GCM' ? 12 : 16
  let iv: Uint8Array
  let ct: Uint8Array
  if (ivOverride && ivOverride.length > 0) {
    iv = ivOverride
    ct = cipherWithIv
  } else {
    if (cipherWithIv.length < ivSize)
      throw new Error(`密文太短，无法解析 IV（需至少 ${ivSize} 字节）`)
    iv = cipherWithIv.slice(0, ivSize)
    ct = cipherWithIv.slice(ivSize)
  }
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      anyArg(mode === 'GCM' ? { name: 'AES-GCM', iv } : { name: 'AES-CBC', iv }),
      key,
      anyArg(ct),
    ),
  )
  return pt
}

// ChaCha20-Poly1305 — Chromium/Edge 119+ 支持。
export async function chachaEncrypt(
  keyBytes: Uint8Array,
  plain: Uint8Array,
  nonce?: Uint8Array,
): Promise<Uint8Array> {
  if (keyBytes.length !== 32) throw new Error('ChaCha20 密钥必须 256 位')
  const actualNonce = nonce && nonce.length > 0 ? nonce : randomBytes(12)
  if (actualNonce.length !== 12) throw new Error('ChaCha20 nonce 必须 12 字节')
  const key = await crypto.subtle.importKey(
    'raw',
    anyArg(keyBytes),
    { name: 'ChaCha20-Poly1305' } as any,
    false,
    ['encrypt', 'decrypt'],
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      anyArg({ name: 'ChaCha20-Poly1305', iv: actualNonce }),
      key,
      anyArg(plain),
    ),
  )
  return concatBytes(actualNonce, ct)
}

export async function chachaDecrypt(
  keyBytes: Uint8Array,
  cipherWithNonce: Uint8Array,
  nonceOverride?: Uint8Array,
): Promise<Uint8Array> {
  if (keyBytes.length !== 32) throw new Error('ChaCha20 密钥必须 256 位')
  let nonce: Uint8Array
  let ct: Uint8Array
  if (nonceOverride && nonceOverride.length > 0) {
    nonce = nonceOverride
    ct = cipherWithNonce
  } else {
    if (cipherWithNonce.length < 12) throw new Error('密文太短，无法解析 nonce')
    nonce = cipherWithNonce.slice(0, 12)
    ct = cipherWithNonce.slice(12)
  }
  const key = await crypto.subtle.importKey(
    'raw',
    anyArg(keyBytes),
    { name: 'ChaCha20-Poly1305' } as any,
    false,
    ['encrypt', 'decrypt'],
  )
  return new Uint8Array(
    await crypto.subtle.decrypt(
      anyArg({ name: 'ChaCha20-Poly1305', iv: nonce }),
      key,
      anyArg(ct),
    ),
  )
}
