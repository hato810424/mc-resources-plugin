/**
 * パターンマッチング用のグローバルマッチャー
 */
class PatternMatcher {
  private patterns: RegExp[];

  constructor(patterns: string[]) {
    this.patterns = patterns.map(pattern =>
      new RegExp(
        '^' +
          pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.+')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]') +
          '$'
      )
    );
  }

  /**
   * 指定されたパスがパターンマッチするかチェック
   */
  matches(path: string): boolean {
    const pathParts = path.split('/');

    return this.patterns.some(regex => {
      // スラッシュが含まれないパターンの場合、パスのいずれかのコンポーネントでマッチをチェック
      const hasSlash = this.patterns.length > 0; // 簡易的なチェック
      if (!hasSlash) {
        return pathParts.some(part => regex.test(part));
      }

      // スラッシュが含まれるパターンの場合、完全パスでマッチをチェック
      return regex.test(path);
    });
  }
}

/**
 * より正確なパターンマッチング
 */
export function matchesPattern(path: string, patterns: string[]): boolean {
  const pathParts = path.split('/');

  return patterns.some(pattern => {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.+')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]') +
        '$'
    );

    // スラッシュが含まれないパターンの場合、パスのいずれかのコンポーネントでマッチをチェック
    if (!pattern.includes('/')) {
      return pathParts.some(part => regex.test(part));
    }

    // スラッシュが含まれるパターンの場合、完全パスでマッチをチェック
    return regex.test(path);
  });
}
