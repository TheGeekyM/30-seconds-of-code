import DocumentIndex from '#src/lib/search/documentIndex.js';
import search from '#src/lib/search/documentSearch.js';
import { deserializeTokens } from '#src/lib/search/utils.js';

const escapeHTML = str =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const omnisearch = {
  openTrigger: document.querySelector('[data-open-modal="omnisearch"]'),
  dialog: document.querySelector('[data-modal="omnisearch"]'),
  closeTrigger: document.querySelector('[data-close-modal="omnisearch"]'),
  searchIcon: document.querySelector('search > svg.icon'),
  searchBox: document.querySelector('#omnisearch'),
  resultsSection: document.querySelector('output[for="omnisearch"]'),
  searchIndex: {},
  searchIndexInitialized: false,
  searchIndexPromise: null,
  latestQuery: '',
  eventListener: null,
  focusedResult: -1,
  isOpen: false,
  prepare() {
    if (this.searchIndexInitialized || this.searchIndexPromise)
      return this.searchIndexPromise;
    this.searchIndexPromise = fetch('/search-data.json')
      .then(data => {
        if (!data.ok) throw new Error(`HTTP ${data.status}`);
        return data.json();
      })
      .then(json => {
        const documents = json.searchIndex.map(
          ({ url, searchTokens, ...data }) => ({
            id: url,
            content: deserializeTokens(searchTokens),
            rawContent: searchTokens,
            url,
            ...data,
          })
        );
        this.searchIndex = new DocumentIndex(documents);
        this.searchDocuments = search(this.searchIndex);
        this.searchIndexInitialized = true;
        if (this.latestQuery) this.search(this.latestQuery);
      })
      .catch(() => {
        this.searchIndexPromise = null;
        if (this.isOpen) this.displayErrorState();
      });
    return this.searchIndexPromise;
  },
  open() {
    this.prepare();
    this.initializeSearchIconAnimation();
    this.dialog.showModal();
    this.bindArrowEvents();
    this.focusedResult = -1;
    this.isOpen = true;
    // Apply a padding in the place of the scrollbar to avoid content jumping.
    // Note that this must come before the scroll lock, otherwise the scrollbar
    // width will be 0.
    document.body.style.paddingInlineEnd = `${this.calculateScrollbarWidth()}px`;
    document.body.dataset.scrollLock = 'true';
  },
  close() {
    this.initializeCloseAnimation();
    this.playCloseAnimation();
    // Note that the animation duration is 185ms, so we wait 190ms before
    // closing the dialog to avoid the user seeing the dialog flashing before
    // it's closed.
    window.setTimeout(() => {
      this.unbindArrowEvents();
      this.dialog.close();
      this.isOpen = false;
      document.body.style.paddingInlineEnd = '';
      document.body.dataset.scrollLock = 'false';
    }, 185);
  },
  search(query) {
    this.latestQuery = query;
    if (!this.searchIndexInitialized || !this.isOpen) return;
    this.playSearchIconAnimation();
    const results = this.searchByKeyphrase(query);
    if (results.length > 0) this.displayResults(results);
    else if (query.length <= 1) this.displayEmptyState();
    else this.displayNotFoundState(query);
    this.focusedResult = -1;
  },
  searchByKeyphrase(keyphrase) {
    let q = keyphrase.toLowerCase().trim();
    if (q.length <= 1) return [];
    return this.searchDocuments(q, 100);
  },
  displayResults(results) {
    this.resultsSection.innerHTML = `
      ${results.length ? this.createResultsHTML('Search results', results) : ''}
    `;
  },
  displayEmptyState() {
    this.resultsSection.innerHTML = this.createEmptyStateHTML();
  },
  displayNotFoundState(query) {
    this.resultsSection.innerHTML = this.createNotFoundStateHTML(query);
  },
  displayErrorState() {
    this.resultsSection.innerHTML = this.createErrorStateHTML();
  },
  createResultsHTML(title, results) {
    return `
      <h2>${title}</h2>
      <ul>${results.map(this.createResultHTML).join('')}</ul>
    `;
  },
  createResultHTML(result) {
    return `
      <li>
        <a href="${escapeHTML(result.url)}">
          ${escapeHTML(result.title)}
          <small>${escapeHTML(result.tag)}</small>
        </a>
      </li>
      `;
  },
  createEmptyStateHTML() {
    return `<p>Start typing a keyphrase to see matching articles.</p>`;
  },
  createErrorStateHTML() {
    return `<p>Search is unavailable right now. Close and reopen search to try again.</p>`;
  },
  createNotFoundStateHTML(query) {
    const escapedQuery = escapeHTML(query);
    return `<p>
      We couldn't find any results for the keyphrase <strong>${escapedQuery}</strong>.
    </p>`;
  },
  calculateScrollbarWidth() {
    return window.innerWidth - document.documentElement.clientWidth;
  },
  initializeSearchIconAnimation() {
    this.searchIconAnimation = this.searchIcon.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.1)' },
        { transform: 'scale(1)' },
      ],
      { duration: 750, delay: 250, easing: 'ease' }
    );
    this.searchIconAnimation.pause();
  },
  playSearchIconAnimation() {
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      this.searchIconAnimation.play();
    }
  },
  initializeCloseAnimation() {
    this.closeAnimation = this.dialog.animate(
      [
        { opacity: '1', transform: 'translateY(0)' },
        { opacity: '0', transform: 'translateY(-20px)' },
      ],
      { duration: 200, easing: 'ease-in' }
    );
    this.closeAnimation.pause();
  },
  playCloseAnimation() {
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      this.closeAnimation.play();
    }
  },
  bindArrowEvents() {
    this.eventListener = e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusNextResult();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusPreviousResult();
      }
    };
    this.dialog.addEventListener('keydown', this.eventListener);
  },
  unbindArrowEvents() {
    this.dialog.removeEventListener('keydown', this.eventListener);
  },
  focusNextResult() {
    const results = this.resultsSection.querySelectorAll('a');
    if (results.length === 0) return;
    this.focusedResult += 1;
    if (this.focusedResult >= results.length) this.focusedResult = 0;
    results[this.focusedResult].focus();
  },
  focusPreviousResult() {
    const results = this.resultsSection.querySelectorAll('a');
    if (results.length === 0) return;
    this.focusedResult -= 1;
    if (this.focusedResult < 0) this.focusedResult = results.length - 1;
    results[this.focusedResult].focus();
  },
};

omnisearch.openTrigger.addEventListener('click', () => {
  omnisearch.open();
});

omnisearch.closeTrigger.addEventListener('click', () => {
  omnisearch.close();
});

omnisearch.dialog.addEventListener('keydown', e => {
  if (e.key === 'Escape' && omnisearch.isOpen) omnisearch.close();
});

omnisearch.dialog.addEventListener('click', e => {
  if (!e.target.closest('search')) omnisearch.close();
});

omnisearch.searchBox.addEventListener('input', e => {
  omnisearch.search(e.target.value);
});
