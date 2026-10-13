/**
 * What a sealed value shows: its last four characters, or nothing.
 *
 * Four characters confirm which account somebody meant. A structured value
 * (an amount with its currency, a signature) is sealed as JSON, and its last
 * four are the JSON's closing quote and brace, so it shows nothing.
 */
export function lastFour(plaintext: string): string | null {
  if (plaintext.length === 0 || plaintext.startsWith('{') || plaintext.startsWith('[')) return null;
  return plaintext.slice(-4);
}
