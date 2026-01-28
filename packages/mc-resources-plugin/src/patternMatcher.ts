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
