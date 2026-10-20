// Script được inject vào tab đang mở để lấy nội dung paper.
// KHÔNG phải ES module: giá trị của biểu thức cuối cùng chính là kết quả trả về cho executeScript.
(() => {
  const clean = (s) => String(s || '').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const text = (sel, root = document) => clean(root.querySelector(sel)?.innerText || '');
  const metaOf = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return clean(el?.getAttribute('content') || '');
  };
  const metaAll = (name) => Array.from(
    document.querySelectorAll(`meta[name="${name}"], meta[property="${name}"]`),
  ).map((el) => clean(el.getAttribute('content'))).filter(Boolean);

  const url = location.href;
  const host = location.hostname.replace(/^www\./, '');
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)/i)
    || url.match(/ar5iv\.[^/]*\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  const arxivId = arxivMatch ? arxivMatch[1] : '';

  const result = {
    url,
    host,
    arxivId,
    title: metaOf('citation_title') || metaOf('og:title') || clean(document.title),
    authors: metaAll('citation_author').slice(0, 8).join(', '),
    venue: metaOf('citation_journal_title') || metaOf('citation_conference_title') || '',
    year: (metaOf('citation_publication_date') || metaOf('citation_date') || '').slice(0, 4),
    kind: 'trang web',
    text: '',
    site: 'generic',
    needsFetch: false,
  };

  /* ---------- Chrome PDF viewer: không đọc được text từ DOM ---------- */
  if (document.contentType === 'application/pdf' || /\.pdf($|\?)/i.test(url)) {
    result.site = 'pdf';
    result.kind = 'PDF (không đọc được trực tiếp)';
    result.needsFetch = !!arxivId; // arXiv thì background sẽ lấy bản abs/html
    result.text = '';
    return result;
  }

  /* ---------- arXiv abstract page ---------- */
  if (host.endsWith('arxiv.org') && /\/abs\//.test(url)) {
    result.site = 'arxiv-abs';
    result.kind = 'abstract (arXiv)';
    const title = text('h1.title').replace(/^Title:\s*/i, '');
    const abs = text('blockquote.abstract').replace(/^Abstract:\s*/i, '');
    const authors = text('div.authors').replace(/^Authors:\s*/i, '');
    const subjects = text('td.tablecell.subjects');
    const comments = text('td.tablecell.comments');
    if (title) result.title = title;
    if (authors) result.authors = authors;
    result.venue = comments || result.venue || 'arXiv preprint';
    result.text = clean([
      `Title: ${title}`,
      `Authors: ${authors}`,
      subjects ? `Subjects: ${subjects}` : '',
      comments ? `Comments: ${comments}` : '',
      '',
      'Abstract:',
      abs,
    ].filter(Boolean).join('\n'));
    result.needsFetch = true; // thử lấy thêm full text HTML nếu có
    return result;
  }

  /* ---------- arXiv HTML full text / ar5iv ---------- */
  if ((host.endsWith('arxiv.org') && /\/html\//.test(url)) || host.includes('ar5iv')) {
    result.site = 'arxiv-html';
    result.kind = 'full text (HTML)';
    const article = document.querySelector('article, .ltx_document, main') || document.body;
    result.title = clean(article.querySelector('h1.ltx_title, h1')?.innerText) || result.title;
    result.text = clean(article.innerText);
    return result;
  }

  /* ---------- OpenReview ---------- */
  if (host.includes('openreview.net')) {
    result.site = 'openreview';
    result.kind = 'abstract + metadata (OpenReview)';
    const title = text('h2.citation_title') || text('h2') || result.title;
    const abs = text('.note-content-value')
      || text('[data-testid="abstract"]')
      || clean(Array.from(document.querySelectorAll('.note-content .note-content-value')).map((e) => e.innerText).join('\n'));
    const authors = text('.forum-authors') || result.authors;
    result.title = title;
    result.authors = authors;
    result.text = clean(`Title: ${title}\nAuthors: ${authors}\n\nAbstract:\n${abs}\n\n${clean(document.querySelector('.forum-note')?.innerText || '')}`);
    return result;
  }

  /* ---------- ACL Anthology ---------- */
  if (host.includes('aclanthology.org')) {
    result.site = 'acl';
    result.kind = 'abstract (ACL Anthology)';
    const title = text('#title') || result.title;
    const abs = text('.card-body .acl-abstract') || text('.acl-abstract');
    const authors = clean(Array.from(document.querySelectorAll('p.lead a')).map((a) => a.innerText).join(', ')) || result.authors;
    result.title = title.replace(/\s*\n.*$/, '');
    result.authors = authors;
    result.text = clean(`Title: ${result.title}\nAuthors: ${authors}\n\n${abs}`);
    return result;
  }

  /* ---------- Semantic Scholar / Papers with Code / generic ---------- */
  const candidates = [
    document.querySelector('article'),
    document.querySelector('main'),
    document.querySelector('#content'),
    document.querySelector('.paper-detail'),
    document.body,
  ].filter(Boolean);
  let best = '';
  for (const el of candidates) {
    const t = clean(el.innerText);
    if (t.length > best.length) best = t;
    if (best.length > 4000) break;
  }
  const desc = metaOf('description') || metaOf('og:description');
  result.text = clean([
    result.title ? `Title: ${result.title}` : '',
    result.authors ? `Authors: ${result.authors}` : '',
    desc ? `\nAbstract (meta): ${desc}` : '',
    '',
    best,
  ].filter(Boolean).join('\n'));
  result.kind = 'nội dung trang (heuristic)';
  return result;
})();
