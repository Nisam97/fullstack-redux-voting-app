import crypto from 'crypto';

export const JOIN_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

/**
 * Generates a random 6-character alphanumeric join code.
 * Uses cryptographically secure random integers.
 * The character set ABCDEFGHJKMNPQRSTUVWXYZ23456789 omits easily confused characters (0, O, 1, I, L).
 *
 * @returns {string} 6-character join code
 */
export function generateJoinCode() {
  let result = '';
  const charsetLength = JOIN_CODE_CHARSET.length;
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    const randomIndex = crypto.randomInt(0, charsetLength);
    result += JOIN_CODE_CHARSET[randomIndex];
  }
  return result;
}

export default generateJoinCode;
