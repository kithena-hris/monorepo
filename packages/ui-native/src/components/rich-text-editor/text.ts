/**
 * The text of the editor's HTML, without its tags: what the character count
 * counts and what "is it empty" asks about. It walks the string rather than
 * stripping tags with a pattern, which a scanner rightly reads as an attempt
 * at sanitising and which a `<` left open can defeat. It is not a sanitiser
 * either: nothing it returns is ever rendered as HTML.
 */
export function textOf(html: string): string {
  let text = '';
  let inTag = false;
  for (const char of html) {
    if (inTag) {
      if (char === '>') inTag = false;
    } else if (char === '<') {
      inTag = true;
    } else {
      text += char;
    }
  }
  return text;
}
