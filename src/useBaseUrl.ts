export function useBaseUrl(baseUrl = '') {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  function url(path: string): string {
    if (/^https?:\/\//.test(path)) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    if (
      cleanBaseUrl.startsWith('/') &&
      (normalizedPath === cleanBaseUrl ||
        normalizedPath.startsWith(`${cleanBaseUrl}/`))
    ) {
      return normalizedPath;
    }

    return cleanBaseUrl + normalizedPath;
  }

  return { url };
}
