/*
 * Typed sums: "12 × 7 =" → 84, as in Apple Notes' Math Notes.
 * A small recursive-descent parser (never eval) for + − × ÷ ^ % √ and
 * parentheses.
 */
const Calc = (() => {
  // The sum just before a trailing "=", e.g. "Total: 3 × (4 + 5) =" → "3 × (4 + 5)".
  const TRAILING_SUM = /((?:[\d.]|[+\-−*/×÷x^%√()]|\s)+)=\s*$/;

  function parse(text) {
    const src = text
      .replace(/[−–]/g, '-')
      .replace(/[×x·]/g, '*')
      .replace(/[÷:]/g, '/')
      .replace(/\s+/g, '');
    let i = 0;
    const peek = () => src[i];
    const take = ch => (src[i] === ch ? (i++, true) : false);

    function expr() {
      let v = term();
      for (;;) {
        if (take('+')) v += term();
        else if (take('-')) v -= term();
        else return v;
      }
    }
    function term() {
      let v = power();
      for (;;) {
        if (take('*')) v *= power();
        else if (take('/')) v /= power();
        else return v;
      }
    }
    function power() {
      const base = unary();
      return take('^') ? Math.pow(base, power()) : base;
    }
    function unary() {
      if (take('-')) return -unary();
      if (take('+')) return unary();
      if (take('√')) return Math.sqrt(unary());
      let v = primary();
      if (take('%')) v /= 100;
      return v;
    }
    function primary() {
      if (take('(')) {
        const v = expr();
        if (!take(')')) throw new Error('Missing )');
        return v;
      }
      const m = src.slice(i).match(/^\d+(?:\.\d+)?|^\.\d+/);
      if (!m) throw new Error('Expected a number');
      i += m[0].length;
      return parseFloat(m[0]);
    }

    const value = expr();
    if (i !== src.length) throw new Error('Unexpected ' + peek());
    return value;
  }

  function format(n) {
    if (!isFinite(n)) return null;
    const rounded = Number(n.toPrecision(12));
    return Math.abs(rounded) >= 1e15 || (rounded !== 0 && Math.abs(rounded) < 1e-9)
      ? rounded.toExponential(6).replace(/\.?0+e/, 'e')
      : String(rounded);
  }

  // The answer for text ending in "<sum> =", or null when there's no sum there.
  function answerFor(textBeforeCaret) {
    const m = textBeforeCaret.match(TRAILING_SUM);
    if (!m) return null;
    const sum = m[1].trim();
    // Needs at least one number and one operator: "2024 =" alone isn't a sum.
    if (!/\d/.test(sum) || !/\d\s*[+\-−*/×÷x^%]|[√(]/.test(sum)) return null;
    try {
      return format(parse(sum));
    } catch {
      return null;
    }
  }

  return { answerFor, parse };
})();
