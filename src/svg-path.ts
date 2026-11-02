/** 只缩写 path 的数字拼写，数值保持同一个 IEEE-754 值；不抽点、不合并曲线，也不改描画属性。 */
export function compactSvgPaths(svg: string): string {
  return svg.replace(/(\sd=")([^"]*)(")/g, (_, before: string, path: string, after: string) => {
    // 圆弧允许紧凑排列标志位；没有完整语法解析时保留原串，不能把 001 当成一个普通坐标缩写。
    if (/[Aa]/.test(path)) return before + path + after;
    return before + path.replace(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, (token, offset: number) => {
      const value = Number(token);
      const prefix = token.startsWith("+") ? "+" : Object.is(value, -0) ? "-" : "";
      const compact = prefix + String(value).replace(/^(-?)0\./, "$1.");
      // 第二个小数点原本承担分隔作用，变成整数时补空格，正负号则始终原样保留。
      return token.startsWith(".") && !compact.startsWith(".") && /[\d.]/.test(path[offset - 1] ?? "")
        ? ` ${compact}` : compact;
    }) + after;
  });
}
