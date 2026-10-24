// Test các hàm thuần JS của app, chạy trong Edge / Chrome ẩn (tests/test_app.py mở /__tests__/run.html).
// Kết quả ghi vào <pre id="out"> dạng "RESULT:[{name, ok, error}]" để Python đọc.
const out = document.getElementById('out');
const results = [];
const eq = (got, want, msg = '') => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${msg} cần ${b}, nhận ${a}`);
};
const ok = (v, msg = 'điều kiện sai') => { if (!v) throw new Error(msg); };
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: String(e?.stack || e) }); }
}

try {
  const srsMod = await import('/js/srs.js');
  const { schedule, srsOf } = srsMod;
  const { eventsToIcs, parseIcs } = await import('/js/ics.js');
  const { setFeedData, allEvents, ownEvents, catOf, loadEvents } = await import('/js/calendar.js');
  const { feedEventsFrom } = await import('/js/calfeeds.js');
  const { lineDiff, subtreeList, treeMarkdownFiles } = await import('/js/notebook-export.js');
  const { locate, locateAfter } = await import('/js/notebook-inline-ai.js');
  const { citesToLinks } = await import('/js/notebook-save.js');
  const { parseCslJson, parseReferences } = await import('/js/bib.js');
  const { loadPages, savePage, newPage, pageById } = await import('/js/notebook.js');
  const { budgetGate, invalidateCost } = await import('/js/budget.js');

  await test('srs: thẻ mới chấm Nhớ → 1 ngày, Dễ → 4 ngày, Quên tăng lapses', () => {
    const a = schedule(null, 2, '2026-01-10');
    eq([a.interval, a.reps, a.due], [1, 1, '2026-01-11']);
    const b = schedule(a, 2, '2026-01-11');
    eq([b.interval, b.due], [3, '2026-01-14']);
    eq(schedule(null, 3, '2026-01-10').interval, 4);
    const c = schedule(b, 0, '2026-01-14');
    eq([c.interval, c.lapses, c.reps], [0, 1, 0]);
    ok(c.ease < b.ease, 'ease phải giảm khi quên');
    eq(srsOf({ known: true, knownAt: '2026-01-01T00:00:00Z' }).interval, 21);
  });

  await test('srs: chấm lại thẻ chưa tới hạn không đẩy lịch đi xa, Quên vẫn học lại', () => {
    let s = schedule(null, 3, '2026-01-10');
    eq([s.interval, s.due], [4, '2026-01-14']);
    for (let i = 0; i < 10; i++) s = schedule(s, 3, '2026-01-10'); // bấm Dễ liên tục cùng ngày (lỗi cũ: lên 10 năm)
    eq([s.interval, s.due, s.early], [4, '2026-01-14', true]);
    const q = schedule(s, 0, '2026-01-10');
    eq([q.interval, q.lapses, !!q.early], [0, 1, false]);
    const cfg = { newPerDay: 5, goodFirst: 2, easyFirst: 7, startEase: 2.5, maxInterval: 30 };
    eq(schedule(null, 2, '2026-01-10', cfg).interval, 2);
    eq(schedule(null, 3, '2026-01-10', cfg).interval, 7);
    eq(schedule({ due: '2026-01-10', interval: 25, ease: 2.5, reps: 5, lapses: 0, firstAt: '2025-10-01', lastAt: '2025-12-16' }, 2, '2026-01-10', cfg).interval, 30, 'không vượt khoảng tối đa');
  });

  await test('srs: sửa lịch ôn bị nhân lên do chấm lặp', () => {
    const { repairSrs } = srsMod;
    const bad = { srs: { due: '2036-01-10', interval: 3650, ease: 4, reps: 12, lapses: 0, firstAt: '2026-01-10', lastAt: '2026-01-10' } };
    const f = repairSrs(bad, { newPerDay: 20, goodFirst: 1, easyFirst: 4, startEase: 2.5, maxInterval: 365 });
    eq([f.interval, f.due, f.ease <= 2.8, f.reps <= 2], [4, '2026-01-14', true, true]);
    eq(repairSrs({ srs: { due: '2026-01-13', interval: 3, ease: 2.5, reps: 2, firstAt: '2026-01-09', lastAt: '2026-01-10' } }), null, 'lịch hợp lệ thì giữ nguyên');
  });

  await test('ics: xuất rồi đọc lại giữ tên, giờ, lặp, nhắc, loại', () => {
    const ev = { id: 'e1', title: 'Họp nhóm, đọc; bài A', date: '2026-10-23', start: '09:00', end: '10:30', repeat: 'weekly', until: '2026-12-01', remind: '15', cat: 'meet', notes: 'dòng 1\ndòng 2' };
    const day = { id: 'e2', title: 'Deadline CVPR', date: '2026-11-14', start: '', end: '', repeat: 'none', cat: 'deadline' };
    const { events } = parseIcs(eventsToIcs([ev, day]));
    eq(events.length, 2);
    const a = events.find((x) => x.icsUid === 'e1@papervault');
    eq([a.title, a.date, a.start, a.end, a.repeat, a.until, String(a.remind), a.cat, a.notes], [ev.title, ev.date, '09:00', '10:30', 'weekly', '2026-12-01', '15', 'meet', 'dòng 1\ndòng 2']);
    const b = events.find((x) => x.icsUid === 'e2@papervault');
    eq([b.date, b.start, b.cat], ['2026-11-14', '', 'deadline']);
  });

  await test('ics: sự kiện huỷ bị bỏ, lặp phức tạp chỉ lấy lần đầu', () => {
    const txt = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x1', 'DTSTART;VALUE=DATE:20261201', 'SUMMARY:Bị huỷ', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:x2', 'DTSTART:20261202T020000Z', 'DTEND:20261202T030000Z', 'SUMMARY:Seminar', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const { events } = parseIcs(txt);
    eq(events.length, 1);
    eq(events[0].repeat, 'none');
    ok(/INTERVAL=2/.test(events[0].notes), 'phải ghi chú quy tắc lặp không hỗ trợ');
  });

  await test('lịch đăng ký: sự kiện chỉ đọc, có loại riêng, bỏ sự kiện quá cũ', async () => {
    await loadEvents(true);
    const txt = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:g1@google.com', 'DTSTART;VALUE=DATE:20991001', 'SUMMARY:Hội nghị', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:g2@google.com', 'DTSTART;VALUE=DATE:20100101', 'SUMMARY:Rất cũ', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const evs = feedEventsFrom(txt, { id: 'cfX' });
    eq(evs.length, 1);
    eq([evs[0].feed, evs[0].cat, evs[0].remind], ['cfX', 'feed:cfX', '']);
    ok(/^fd_cfX_g1_google\.com_2099-10-01$/.test(evs[0].id), `id lạ: ${evs[0].id}`);
    const own = ownEvents().length;
    setFeedData([['feed:cfX', 'Lịch Google', '#123456']], evs);
    eq(allEvents().length, own + 1);
    eq(ownEvents().length, own);
    eq(catOf('feed:cfX'), ['feed:cfX', 'Lịch Google', '#123456']);
    eq(catOf('khong-co')[0], 'other');
    setFeedData([], []);
    eq(allEvents().length, own);
  });

  await test('âm lịch: Tết các năm, tháng nhuận, can chi, ngày lễ', async () => {
    const { lunarOf, yearName, yearAnimal, dayName, holidaysOf, monthLabel } = await import('/js/lunar.js');
    const l = (s) => { const x = lunarOf(s); return [x.day, x.month, x.year, x.leap]; };
    eq(l('2024-02-10'), [1, 1, 2024, false], 'Tết Giáp Thìn');
    eq(l('2025-01-29'), [1, 1, 2025, false], 'Tết Ất Tỵ');
    eq(l('2026-02-17'), [1, 1, 2026, false], 'Tết Bính Ngọ');
    eq(l('2026-02-16')[0] >= 29 && l('2026-02-16')[1] === 12, true, 'hôm trước Tết là cuối tháng Chạp');
    eq(l('2023-03-22'), [1, 2, 2023, true], 'tháng Hai nhuận 2023');
    eq(l('2025-07-25'), [1, 6, 2025, true], 'tháng Sáu nhuận 2025');
    eq(monthLabel(lunarOf('2023-03-22')), 'tháng Hai nhuận');
    eq([yearName(2012), yearName(2024), yearName(2026)], ['Nhâm Thìn', 'Giáp Thìn', 'Bính Ngọ']);
    eq(yearAnimal(2026).name, 'Ngựa');
    eq(dayName(lunarOf('2024-02-10').jd), 'Giáp Thìn', 'mùng 1 Tết 2024 là ngày Giáp Thìn');
    eq(holidaysOf('2026-02-16').map((h) => h.name), ['Giao thừa (29 Tết)'], 'tháng Chạp 2025 thiếu: giao thừa là 29 Tết');
    eq(holidaysOf('2025-01-28').map((h) => h.name), ['Giao thừa (29 Tết)']);
    eq(holidaysOf('2026-02-17').map((h) => [h.name, h.off]), [['Tết Nguyên đán', true]]);
    eq(holidaysOf('2026-09-02').map((h) => h.name), ['Quốc khánh']);
    ok(holidaysOf('2026-09-25').some((h) => h.name === 'Tết Trung thu'), 'Trung thu 2026 là 25/9');
    eq(holidaysOf('2023-04-05').filter((h) => h.lunar).length, 0, 'không lấy ngày lễ âm trong tháng nhuận');
  });

  await test('Chat: độ dài câu trả lời co giãn theo câu hỏi hoặc theo lựa chọn', async () => {
    const { buildChatSystem, buildAskSystem, CHAT_LENGTHS } = await import('/js/prompts.js');
    eq(CHAT_LENGTHS.map((x) => x[0]), ['', 'short', 'long']);
    ok(buildChatSystem({}).includes('vừa đủ cho đúng câu hỏi'), 'mặc định tự co giãn');
    ok(buildChatSystem({}, { length: 'short' }).includes('NGẮN GỌN'));
    ok(buildChatSystem({}, { length: 'long' }).includes('CHI TIẾT'));
    ok(buildAskSystem({ chatLength: 'short' }).includes('NGẮN GỌN'), 'tab Hỏi đáp theo cùng lựa chọn');
    ok(!buildAskSystem({}).includes('Trả lời ngắn gọn, có cấu trúc'), 'bỏ quy tắc ép ngắn cũ');
  });

  await test('Chat: ngữ cảnh kèm theo từ Hướng nghiên cứu, mạng trích dẫn, câu tô, bài giảng, hỏi đáp', async () => {
    const cx = await import('/js/chatctx.js');
    const { store } = await import('/js/store.js');
    const lib = { id: 'p_lib', title: 'Visual Instruction Tuning', arxivId: '2304.08485' };
    store.papers = [lib];
    const p = {
      id: 'p_main', title: 'Main paper',
      researchMap: {
        at: '2026-10-01T00:00:00Z',
        papers: [
          { id: 'R1', relation: 'ref', title: 'Old tool', citations: 50, roleText: 'dùng làm công cụ' },
          { id: 'C1', relation: 'cit', title: 'Visual Instruction Tuning', arxiv: '2304.08485', citations: 900, influential: true },
          { id: 'S1', relation: 'pin', title: 'Pinned one', pinned: true },
        ],
        data: {
          overview: 'P kế thừa [R1] và được [C1] mở rộng.',
          comparison: [{ paper: 'R1', relation: 'tool', method: 'Adam' }, { paper: 'C1', relation: 'extends', method: 'instruction tuning', difference: 'dữ liệu GPT-4' }, { paper: 'S1', relation: 'related' }],
          gaps: [{ gap: 'Thiếu đánh giá đa ngôn ngữ', status: 'open', papers: ['C1'] }],
          directions: [{ title: 'VQA tiếng Việt', idea: 'Tạo dữ liệu', gap_ids: ['G1'], builds_on: ['C1'] }],
        },
      },
      pdfMarks: [{ auto: true, kind: 'evidence', page: 3, text: 'accuracy improves by 4.2', why: 'kết quả chính' }, { text: 'câu tôi tô', page: 5 }],
      lecture: { sections: { intro: { lead: 'Giới thiệu' } } },
      qa: [{ q: 'Dataset nào?', a: 'VQAv2 và GQA.' }],
    };
    const net = cx.networkOf(p);
    eq(net.map((x) => x.code), ['S1', 'C1', 'R1'], 'bài ghim trước, rồi mở rộng, công cụ cuối');
    eq(net.find((x) => x.code === 'C1').lib?.id, 'p_lib', 'nhận ra bài có trong thư viện theo arXiv');
    const ctx = cx.ctxOf({});
    const block = cx.extraBlock(p, 'P2', ctx);
    ok(block.includes('[P2.R1]') && block.includes('[P2.C1]'), 'đổi mã bài sang mã theo paper trong hội thoại');
    ok(block.includes('Khoảng trống G1') && !block.includes('P2.G1'), 'G1 là khoảng trống, không đổi mã');
    ok(block.includes('<citation_network paper="P2">') && block.includes('có trong thư viện'), 'mạng trích dẫn ghi bài có trong thư viện');
    ok(block.includes('<pdf_highlights') && block.includes('vì: kết quả chính'), 'câu AI tô kèm lý do');
    const off = cx.extraBlock(p, 'P2', { ...ctx, network: false, research: false, marks: false });
    eq(off.includes('citation_network') || off.includes('research_directions') || off.includes('pdf_highlights'), false, 'tắt thì không gửi');
    eq(cx.retrievalDocs(p, ctx).map((d) => d.src).includes('hỏi đáp trước'), true);
    eq(cx.librarySuggestions({ paperIds: ['p_main'] }, [{ p, label: 'P2' }]).map((s) => [s.p.id, s.via]), [['p_lib', 'P2.C1']]);
    eq(cx.relatedByCode([{ p, label: 'P2' }], 'P2.C1')?.title, 'Visual Instruction Tuning');
    store.papers = [];
  });

  await test('lineDiff: so sánh theo dòng', () => {
    eq(lineDiff('a\nb\nc', 'a\nc\nd').map((x) => x.t + x.s), ['=a', '-b', '=c', '+d']);
    eq(lineDiff('', 'x').map((x) => x.t + x.s), ['-', '+x']);
  });

  await test('locate / locateAfter: tìm lại đoạn đã chọn sau khi trang đổi', () => {
    const s = 'mot hai ba hai bon';
    eq(locate(s, 'hai', 11), 11);
    eq(locate(s, 'hai', 0), 4);
    eq(locate(s, 'khong', 0), -1);
    eq(locateAfter(s, 'ba ', 11), 11);
    eq(locateAfter('xx ba yy', 'ba ', 0), 6);
    eq(locateAfter(s, 'zzz', 3), s.length);
  });

  await test('citesToLinks: [P1, P2] thành liên kết paper', () => {
    const m = new Map([['P1', 'p_1'], ['P3', 'p_3']]);
    eq(citesToLinks('theo [P1, P2] và [P3]', m), 'theo [[@p_1]] [P2] và [[@p_3]]');
    eq(citesToLinks('không đổi [P1]', new Map()), 'không đổi [P1]');
  });

  await test('CSL JSON và BibTeX: đọc tên, tác giả, năm, DOI, arXiv', () => {
    const csl = JSON.stringify([{ id: 'a', type: 'article-journal', title: 'Deep Residual Learning', author: [{ given: 'Kaiming', family: 'He' }, { literal: 'MSRA' }],
      issued: { 'date-parts': [[2016, 6]] }, 'container-title': 'CVPR', DOI: 'https://doi.org/10.1109/CVPR.2016.90', keyword: 'resnet, cnn' }, { id: 'b' }]);
    const r = parseReferences(csl, 'lib.json');
    eq(r.length, 1);
    eq([r[0].title, r[0].authors, r[0].year, r[0].venue, r[0].doi, r[0].keywords], ['Deep Residual Learning', ['Kaiming He', 'MSRA'], '2016', 'CVPR', '10.1109/CVPR.2016.90', ['resnet', 'cnn']]);
    eq(parseCslJson('không phải json'), []);
    const bib = parseReferences('@article{vaswani17, title={Attention Is All You Need}, author={Vaswani, Ashish and Shazeer, Noam}, year={2017}, eprint={1706.03762}}');
    eq([bib[0].title, bib[0].year, bib[0].arxivId], ['Attention Is All You Need', '2017', '1706.03762']);
  });

  await test('Xuất cả nhánh ra Markdown: cây thư mục, tên file an toàn, liên kết và ảnh', async () => {
    const root = await savePage(newPage({ title: 'Dự án: A/B', content: 'gốc #tag' }));
    const kid = await savePage(newPage({ title: 'Con 1', parentId: root.id, content: 'xem [[Dự án: A/B]] và [[Dự án: A/B#Mục|bí danh]]\n![hình|300](/api/image/0123456789abcdef.png)\n```\n[[Dự án: A/B]] trong code\n```' }));
    const gk = await savePage(newPage({ title: 'Cháu', parentId: kid.id, content: '[[Con 1]] ![[Con 1]]' }));
    await loadPages(true);
    const list = subtreeList(pageById(root.id));
    eq(list.map((x) => [x.p.title, x.depth, x.num]), [['Dự án: A/B', 0, ''], ['Con 1', 1, '1'], ['Cháu', 2, '1.1']]);
    const { files, images } = treeMarkdownFiles(list, 'Out');
    eq(files.map((f) => f.name), ['Out/Dự án A B.md', 'Out/Con 1/Con 1.md', 'Out/Con 1/Cháu.md']);
    const k = files[1].data;
    ok(k.includes('[[Dự án A B|Dự án: A/B]]'), 'liên kết tới trang có ký tự cấm phải đổi sang tên file + bí danh');
    ok(k.includes('[[Dự án A B#Mục|bí danh]]'), 'giữ #mục và bí danh');
    ok(k.includes('![hình|300](../attachments/0123456789abcdef.png)'), 'ảnh trỏ tới attachments/ theo đường dẫn tương đối');
    ok(k.includes('[[Dự án: A/B]] trong code'), 'không sửa trong khối code');
    ok(files[2].data.includes('[[Con 1]] ![[Con 1]]'), 'tên file trùng tiêu đề thì giữ nguyên liên kết');
    ok(files[0].data.startsWith('---\ntitle: "Dự án: A/B"\naliases: ["Dự án: A/B"]'), 'front matter có title và aliases');
    eq(images, ['0123456789abcdef.png']);
    void gk;
  });

  await test('Ngân sách AI: chặn khi vượt, đổi model rẻ, nút Thử không bị chặn', async () => {
    invalidateCost();
    const base = { provider: 'anthropic', models: { anthropic: 'claude-sonnet-4-5' } };
    let blocked = null;
    try { await budgetGate({ ...base, aiBudget: { limit: 1, mode: 'block', warnAt: 0.8 } }, 'chat'); } catch (e) { blocked = e; }
    ok(blocked?.budget, 'phải chặn khi đã vượt (máy chủ test có sẵn $18 chi phí)');
    const cheap = await budgetGate({ ...base, aiBudget: { limit: 1, mode: 'cheap' } }, 'chat');
    eq(cheap.models.anthropic, 'claude-haiku-4-5');
    const t = await budgetGate({ ...base, aiBudget: { limit: 1, mode: 'block' } }, 'test');
    eq(t.models.anthropic, 'claude-sonnet-4-5');
    const off = await budgetGate({ ...base, aiBudget: { limit: 0, mode: 'block' } }, 'chat');
    eq(off.models.anthropic, 'claude-sonnet-4-5');
    const roomy = await budgetGate({ ...base, aiBudget: { limit: 1000, mode: 'block' } }, 'chat');
    eq(roomy.models.anthropic, 'claude-sonnet-4-5');
  });
} catch (e) {
  results.push({ name: 'nạp module', ok: false, error: String(e?.stack || e) });
}
out.textContent = `RESULT:${JSON.stringify(results)}`;
