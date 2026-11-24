import { describe, expect, it } from 'vitest';

import { useBaseUrl } from '../src/useBaseUrl.js';

describe('useBaseUrl', () => {
  it('joins a base URL and a relative path', () => {
    const { url } = useBaseUrl('https://example.test/api/');

    expect(url('movies')).toBe('https://example.test/api/movies');
  });

  it('does not prefix absolute URLs', () => {
    const { url } = useBaseUrl('/app');

    expect(url('https://cdn.example.test/image.jpg')).toBe(
      'https://cdn.example.test/image.jpg',
    );
  });

  it('does not duplicate a path base URL', () => {
    const { url } = useBaseUrl('/app/');

    expect(url('/app/movies')).toBe('/app/movies');
    expect(url('/app')).toBe('/app');
  });

  it('normalizes paths without a base URL', () => {
    const { url } = useBaseUrl();

    expect(url('movies')).toBe('/movies');
  });
});
