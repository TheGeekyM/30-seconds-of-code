import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { searchDocuments } = vi.hoisted(() => ({ searchDocuments: vi.fn() }));

vi.mock('#src/lib/search/documentSearch.js', () => ({
  default: vi.fn(() => searchDocuments),
}));

const createElement = () => {
  const listeners = {};
  return {
    listeners,
    innerHTML: '',
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener: vi.fn(),
    animate: () => ({ pause() {}, play() {} }),
    showModal: vi.fn(),
    close: vi.fn(),
    querySelectorAll: () => [],
    dispatch(type, event = {}) {
      (listeners[type] || []).forEach(fn => fn(event));
    },
  };
};

const searchIndexData = {
  searchIndex: [
    {
      url: '/js/s/array-compare',
      searchTokens: 'array:2 compar',
      title: 'Compare arrays',
      tag: 'JavaScript',
    },
  ],
};

const okResponse = (json = searchIndexData) => ({
  ok: true,
  status: 200,
  json: async () => json,
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let elements;
let fetchMock;

const setup = async () => {
  elements = {
    openTrigger: createElement(),
    dialog: createElement(),
    closeTrigger: createElement(),
    searchIcon: createElement(),
    searchBox: createElement(),
    resultsSection: createElement(),
  };
  const selectors = {
    '[data-open-modal="omnisearch"]': elements.openTrigger,
    '[data-modal="omnisearch"]': elements.dialog,
    '[data-close-modal="omnisearch"]': elements.closeTrigger,
    'search > svg.icon': elements.searchIcon,
    '#omnisearch': elements.searchBox,
    'output[for="omnisearch"]': elements.resultsSection,
  };
  vi.stubGlobal('document', {
    querySelector: sel => selectors[sel] ?? null,
    body: { style: {}, dataset: {} },
    documentElement: { clientWidth: 1000 },
  });
  vi.stubGlobal('window', {
    innerWidth: 1000,
    setTimeout: fn => fn(),
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  await import('#src/astro/scripts/omnisearch.js');
};

const open = () => elements.openTrigger.dispatch('click');
const close = () => elements.closeTrigger.dispatch('click');
const type = value =>
  elements.searchBox.dispatch('input', { target: { value } });

describe('omnisearch', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse());
    searchDocuments.mockReset();
    searchDocuments.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loading the search index', () => {
    it('fetches the search data when opened', async () => {
      await setup();
      open();
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/search-data.json');
    });

    it('does not fetch again while a request is in flight', async () => {
      let resolveFetch;
      fetchMock = vi.fn(
        () => new Promise(resolve => (resolveFetch = resolve))
      );
      await setup();
      open();
      close();
      open();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      resolveFetch(okResponse());
      await flush();
    });

    it('does not fetch again once the index is loaded', async () => {
      await setup();
      open();
      await flush();
      close();
      open();
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('runs the latest query typed before the index finished loading', async () => {
      let resolveFetch;
      fetchMock = vi.fn(
        () => new Promise(resolve => (resolveFetch = resolve))
      );
      searchDocuments.mockReturnValue([
        { url: '/js/s/array-compare', title: 'Compare arrays', tag: 'JS' },
      ]);
      await setup();
      open();
      type('ar');
      type('array');
      expect(searchDocuments).not.toHaveBeenCalled();
      resolveFetch(okResponse());
      await flush();
      expect(searchDocuments).toHaveBeenCalledTimes(1);
      expect(searchDocuments).toHaveBeenCalledWith('array', 100);
      expect(elements.resultsSection.innerHTML).toContain('Compare arrays');
    });

    it('does not search after loading if nothing was typed', async () => {
      await setup();
      open();
      await flush();
      expect(searchDocuments).not.toHaveBeenCalled();
      expect(elements.resultsSection.innerHTML).toBe('');
    });
  });

  describe('error handling', () => {
    it('shows the error state when the response is not ok', async () => {
      fetchMock = vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      }));
      await setup();
      open();
      await flush();
      expect(elements.resultsSection.innerHTML).toContain(
        'Search is unavailable right now'
      );
    });

    it('shows the error state when the request rejects', async () => {
      fetchMock = vi.fn(async () => {
        throw new Error('network');
      });
      await setup();
      open();
      await flush();
      expect(elements.resultsSection.innerHTML).toContain(
        'Search is unavailable right now'
      );
    });

    it('does not show the error state if search was closed', async () => {
      let rejectFetch;
      fetchMock = vi.fn(
        () => new Promise((_, reject) => (rejectFetch = reject))
      );
      await setup();
      open();
      close();
      rejectFetch(new Error('network'));
      await flush();
      expect(elements.resultsSection.innerHTML).toBe('');
    });

    it('retries fetching when reopened after a failure', async () => {
      fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(okResponse());
      searchDocuments.mockReturnValue([
        { url: '/a', title: 'Result A', tag: 'JS' },
      ]);
      await setup();
      open();
      await flush();
      close();
      open();
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      type('array');
      expect(elements.resultsSection.innerHTML).toContain('Result A');
    });
  });

  describe('rendering', () => {
    it('escapes result titles, tags and urls', async () => {
      searchDocuments.mockReturnValue([
        {
          url: '/x" onmouseover="alert(1)',
          title: '<img src=x onerror=alert(1)>',
          tag: '<b>tag</b> & "more"',
        },
      ]);
      await setup();
      open();
      await flush();
      type('xss');
      const html = elements.resultsSection.innerHTML;
      expect(html).toContain(
        'href="/x&quot; onmouseover=&quot;alert(1)"'
      );
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain(
        '<small>&lt;b&gt;tag&lt;/b&gt; &amp; &quot;more&quot;</small>'
      );
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<b>');
    });

    it('quotes the result href attribute', async () => {
      searchDocuments.mockReturnValue([
        { url: '/js/s/array-compare', title: 'Compare', tag: 'JS' },
      ]);
      await setup();
      open();
      await flush();
      type('array');
      expect(elements.resultsSection.innerHTML).toContain(
        '<a href="/js/s/array-compare">'
      );
    });

    it('escapes single quotes in result fields', async () => {
      searchDocuments.mockReturnValue([
        { url: "/it's", title: "It's here", tag: 'JS' },
      ]);
      await setup();
      open();
      await flush();
      type('here');
      const html = elements.resultsSection.innerHTML;
      expect(html).toContain('href="/it&#039;s"');
      expect(html).toContain('It&#039;s here');
    });

    it('escapes the query in the not found state', async () => {
      await setup();
      open();
      await flush();
      type('<script>"x"</script>');
      expect(elements.resultsSection.innerHTML).toContain(
        '<strong>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</strong>'
      );
    });

    it('shows the empty state for single character queries', async () => {
      await setup();
      open();
      await flush();
      type('a');
      expect(elements.resultsSection.innerHTML).toContain(
        'Start typing a keyphrase'
      );
    });
  });

  describe('search box', () => {
    it('searches on input events', async () => {
      searchDocuments.mockReturnValue([
        { url: '/a', title: 'Result A', tag: 'JS' },
      ]);
      await setup();
      open();
      await flush();
      type('array');
      expect(searchDocuments).toHaveBeenCalledWith('array', 100);
      expect(elements.resultsSection.innerHTML).toContain('Result A');
    });

    it('does not listen to keyup events', async () => {
      await setup();
      expect(elements.searchBox.listeners.input).toHaveLength(1);
      expect(elements.searchBox.listeners.keyup).toBeUndefined();
    });
  });
});
