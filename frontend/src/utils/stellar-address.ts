// Minimal Stellar StrKey validation.
//
// Stellar public keys are base32-encoded with a version byte and a CRC16-XModem
// checksum appended. The checksum is what makes an address that merely looks
// valid actually valid — catching typos that a plain character regex misses.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function crc16Xmodem(bytes: number[]): number {
  let crc = 0x0000;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function decodeBase32(encoded: string): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of encoded) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes;
}

/**
 * Returns true when the string is a checksum-valid Stellar (G...) public key.
 */
export function isValidStellarAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!/^G[A-Z2-7]{55}$/.test(trimmed)) return false;

  const decoded = decodeBase32(trimmed);
  if (!decoded || decoded.length !== 35) return false;

  const versionByte = decoded[0];
  if (versionByte !== 6 << 3) return false; // version byte for ed25519 public key

  const payload = decoded.slice(0, 33);
  const checksum = decoded.slice(33);
  const expected = crc16Xmodem(payload);

  // StrKey checksums are serialized little-endian.
  return checksum[0] === (expected & 0xff) && checksum[1] === (expected >> 8);
}
