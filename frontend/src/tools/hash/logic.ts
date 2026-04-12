import MD5 from 'crypto-js/md5'
import SHA1 from 'crypto-js/sha1'
import SHA256 from 'crypto-js/sha256'
import SHA512 from 'crypto-js/sha512'
import encUtf8 from 'crypto-js/enc-utf8'

export type HashAlgo = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512'

export const HASH_ALGOS: HashAlgo[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512']

export function computeHash(algo: HashAlgo, text: string): string {
  const msg = encUtf8.parse(text)
  switch (algo) {
    case 'MD5':
      return MD5(msg).toString()
    case 'SHA-1':
      return SHA1(msg).toString()
    case 'SHA-256':
      return SHA256(msg).toString()
    case 'SHA-512':
      return SHA512(msg).toString()
  }
}

export function computeAll(text: string): Record<HashAlgo, string> {
  return {
    'MD5': computeHash('MD5', text),
    'SHA-1': computeHash('SHA-1', text),
    'SHA-256': computeHash('SHA-256', text),
    'SHA-512': computeHash('SHA-512', text),
  }
}
