import { createHash, createVerify, generateKeyPairSync, randomBytes, createSign } from 'node:crypto';

export function generateChallenge(): string {
  return randomBytes(32).toString('hex');
}

export function verifySignature(publicKey: string, challenge: string, signature: string): boolean {
  try {
    const verify = createVerify('SHA256');
    verify.update(challenge);
    verify.end();
    return verify.verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return `mst_${randomBytes(32).toString('hex')}`;
}

export function generateRefreshToken(): string {
  return `msr_${randomBytes(48).toString('hex')}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/** Utility for tests and SDK: generate an RSA keypair */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/** Utility for tests and SDK: sign a challenge with a private key */
export function signChallenge(privateKey: string, challenge: string): string {
  const sign = createSign('SHA256');
  sign.update(challenge);
  sign.end();
  return sign.sign(privateKey, 'base64');
}
