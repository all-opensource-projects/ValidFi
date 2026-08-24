import { isValidStellarAddress } from '@/utils/stellar-address';

describe('isValidStellarAddress', () => {
  it('accepts a checksum-valid Stellar ed25519 public key', () => {
    expect(
      isValidStellarAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    ).toBe(true);
  });

  it('rejects a correctly formatted key with a bad checksum', () => {
    // Same valid key with the last few chars altered to corrupt the checksum.
    expect(
      isValidStellarAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).toBe(false);
  });

  it('rejects non-Stellar strings', () => {
    expect(isValidStellarAddress('not-an-address')).toBe(false);
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('rejects wrong lengths', () => {
    expect(isValidStellarAddress('G' + 'A'.repeat(54))).toBe(false);
    expect(isValidStellarAddress('G' + 'A'.repeat(56))).toBe(false);
  });

  it('rejects lowercase characters', () => {
    expect(
      isValidStellarAddress('gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaawhf')
    ).toBe(false);
  });
});
