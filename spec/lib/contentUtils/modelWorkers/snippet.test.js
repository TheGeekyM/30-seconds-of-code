import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '#spec/mocks/lib/contentUtils/config.js';
import FileHandler from '#src/lib/contentUtils/fileHandler.js';
import { extractSnippetData } from '#src/lib/contentUtils/modelWorkers/snippet.js';

vi.mock('#src/lib/contentUtils/config.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, ...config };
});

vi.mock('#src/lib/contentUtils/fileHandler.js', () => ({
  default: { read: vi.fn() },
}));

vi.mock('#src/lib/contentUtils/markdownParser/markdownParser.js', () => ({
  default: {
    parse: vi.fn(async text => (text ? `<p>${text}</p>` : null)),
  },
}));

vi.mock('#src/lib/contentUtils/ranker.js', () => ({
  default: { rankIndexableContent: vi.fn(() => 0.5) },
}));

const languageData = new Map([
  ['javascript', { short: 'js', long: 'javascript', name: 'JavaScript' }],
]);

const buildSnippet = (overrides = {}) => ({
  filePath: `${config.snippetPrefix}js/s/my-snippet.md`,
  title: 'My snippet',
  tags: ['array', 'function'],
  language: 'javascript',
  body: 'Some body text.',
  excerpt: 'A short excerpt.',
  cover: 'cover',
  dateModified: new Date('2024-01-01'),
  listed: true,
  ...overrides,
});

const extract = async snippets => {
  FileHandler.read.mockResolvedValue(snippets);
  return extractSnippetData(config.snippetGlob, languageData);
};

describe('extractSnippetData', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should not warn for a complete snippet', async () => {
    const [result] = await extract([buildSnippet()]);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(result.id).toBe('js/s/my-snippet');
    expect(result.tags).toBe('array;function');
  });

  describe('tags', () => {
    it('should default tags to an empty list when missing', async () => {
      const snippet = buildSnippet();
      delete snippet.tags;

      const [result] = await extract([snippet]);

      expect(result.tags).toBe('');
    });

    it('should not throw when tags are missing', async () => {
      const snippet = buildSnippet();
      delete snippet.tags;

      await expect(extract([snippet])).resolves.toHaveLength(1);
    });

    it('should still produce tokens when tags are missing', async () => {
      const snippet = buildSnippet();
      delete snippet.tags;

      const [result] = await extract([snippet]);

      expect(typeof result.recTokens).toBe('string');
      expect(result.recTokens.length).toBeGreaterThan(0);
    });
  });

  describe('missing title', () => {
    it('should warn when the title is missing', async () => {
      const snippet = buildSnippet({ title: undefined });

      await extract([snippet]);

      expect(warnSpy).toHaveBeenCalledWith(
        `Snippet ${snippet.filePath} is missing a title`
      );
    });

    it('should warn when the title is empty', async () => {
      const snippet = buildSnippet({ title: '' });

      await extract([snippet]);

      expect(warnSpy).toHaveBeenCalledWith(
        `Snippet ${snippet.filePath} is missing a title`
      );
    });

    it('should not warn about the title when present', async () => {
      await extract([buildSnippet()]);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('is missing a title')
      );
    });
  });

  describe('missing excerpt', () => {
    it('should warn when the excerpt is missing', async () => {
      const snippet = buildSnippet({ excerpt: undefined });

      await extract([snippet]);

      expect(warnSpy).toHaveBeenCalledWith(
        `Snippet ${snippet.filePath} is missing an excerpt`
      );
    });

    it('should warn when the excerpt is empty', async () => {
      const snippet = buildSnippet({ excerpt: '' });

      await extract([snippet]);

      expect(warnSpy).toHaveBeenCalledWith(
        `Snippet ${snippet.filePath} is missing an excerpt`
      );
    });

    it('should not warn about the excerpt when present', async () => {
      await extract([buildSnippet()]);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('is missing an excerpt')
      );
    });
  });

  describe('unknown language', () => {
    it('should warn when the language is not found', async () => {
      const snippet = buildSnippet({ language: 'cobol' });

      await extract([snippet]);

      expect(warnSpy).toHaveBeenCalledWith(
        `Language cobol not found for snippet ${snippet.filePath}`
      );
    });

    it('should keep the language key when the language is not found', async () => {
      const [result] = await extract([buildSnippet({ language: 'cobol' })]);

      expect(result.languageKey).toBe('cobol');
    });

    it('should not warn when the snippet has no language', async () => {
      await extract([buildSnippet({ language: undefined })]);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not warn when the language is found', async () => {
      await extract([buildSnippet({ language: 'javascript' })]);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('not found for snippet')
      );
    });
  });

  it('should emit one warning per problem for each snippet', async () => {
    const first = buildSnippet({
      filePath: `${config.snippetPrefix}js/s/first.md`,
      title: undefined,
    });
    const second = buildSnippet({
      filePath: `${config.snippetPrefix}js/s/second.md`,
      excerpt: undefined,
      language: 'cobol',
    });

    await extract([first, second]);

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith(
      `Snippet ${first.filePath} is missing a title`
    );
    expect(warnSpy).toHaveBeenCalledWith(
      `Snippet ${second.filePath} is missing an excerpt`
    );
    expect(warnSpy).toHaveBeenCalledWith(
      `Language cobol not found for snippet ${second.filePath}`
    );
  });
});
