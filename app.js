/* ============================================================
 * 1024 私人阅读器
 * 内容存放于 GitHub 私有仓库, 通过 GitHub API + token 读取
 * token 仅存浏览器 localStorage, 不落任何服务器
 * ============================================================ */

const CONFIG = {
  owner: 'yun-ai-base',
  repo: 'book-1024',
  branch: 'main'
};
const TOKEN_KEY = 'bk1024_token';
const FONT_KEY = 'bk1024_font';
const THEME_KEY = 'bk1024_theme';
const CHAP_KEY = 'bk1024_chapter';

/* 书籍配置: 每本书的文件名 + 内容标题表 */
const BOOKS = [
  {
    id: 'baijie',
    file: 'baijie.md',
    title: '白洁传',
    chapterTitles: {
      1: '失身的新婚少妇', 2: '欲望中沉浮一夜哀羞', 3: '流氓与少女',
      4: '偷情的少妇', 5: '过去的哀伤', 6: '放纵的外出学习',
      7: '红杏再出墙', 8: '风情万种', 9: '欲海娇妻',
      10: '一路风流荡少妇', 11: '意乱情迷'
    }
  },
  {
    id: 'zhangmin',
    file: 'zhangmin.md',
    title: '张敏传',
    chapterTitles: {
      1: '公关少妇', 2: '上海五日淫', 3: '少妇推销员',
      4: '淫辱少妇', 5: '放荡岁月', 6: '欲海无边'
    }
  }
];

let currentBook = BOOKS[0];
let bookChapters = [];   // [{id, title, paras}]
let currentChapter = 0;
let allBooks = {};       // {bookId: rawText}

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const overlay = $('authOverlay'), reader = $('reader');
const loadingOverlay = $('loadingOverlay'), loadingText = $('loadingText');

/* ---------- 工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 阿拉伯数字 → 中文数字 (1→一, 11→十一, 20→二十) */
function cnNum(n) {
  const c = ['零','一','二','三','四','五','六','七','八','九'];
  if (n <= 9) return c[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + c[n - 10];
  return c[Math.floor(n / 10)] + '十' + (n % 10 ? c[n % 10] : '');
}

function showLoading(msg) {
  loadingText.textContent = msg || '正在加载…';
  loadingOverlay.classList.remove('hidden');
}
function hideLoading() { loadingOverlay.classList.add('hidden'); }

/* ---------- Token 管理 ---------- */
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }

/* ---------- GitHub API ---------- */
async function fetchBookFile(token, fileName) {
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${fileName}?ref=${CONFIG.branch}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.raw+json',
      'Authorization': `token ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (res.status === 401) throw new Error('token 无效或已过期');
  if (res.status === 403) throw new Error('无权访问该仓库(token 未授权此仓库)');
  if (res.status === 404) throw new Error('仓库或文件不存在');
  if (!res.ok) throw new Error(`GitHub 返回错误 ${res.status}`);
  return await res.text();
}

/* ---------- 章节解析 ----------
 * 章节标记 "Chapter_N" 可能独立成行, 也可能粘连在上一章正文末尾
 * 判定标准: Chapter_N 出现在"行尾"(之后到换行符之间无其他内容),
 * 且整段不是目录那行(多个 Chapter 连写在一行)。
 * 这样既识别独立成行的标记, 也识别正文末尾粘连的标记 */
function parseChapters(raw, book) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const chaps = [];
  let current = null;

  for (let line of lines) {
    const t = line.trim();
    // 目录行(同一行连写多个 Chapter_): 跳过
    if (/(?:^|\s)Chapter_\d+(?:\s+Chapter_\d+)+\s*$/.test(t)) continue;

    // 独立成行 或 行首就是 Chapter_N → 作为章节标记
    const m = t.match(/^(Chapter_\d+)/);
    if (m) {
      if (current) chaps.push(current);
      const id = parseInt(m[1].replace('Chapter_', ''), 10);
      current = { id, title: `第${cnNum(id)}章`, paras: [] };
      // 行首是 Chapter_N 但行尾还有内容(粘连): 剩余部分算进本章
      const rest = t.slice(m[1].length).trim();
      if (rest) current.paras.push(rest);
      continue;
    }

    // 行尾粘连的 Chapter_N(正文... Chapter_6): 把标记拆出, 正文归入上一章, 开启新章
    const tail = t.match(/^(.*?)(Chapter_\d+)\s*$/);
    if (tail && tail[1].trim()) {
      if (current) {
        current.paras.push(tail[1].trim());
        chaps.push(current);
      }
      const id = parseInt(tail[2].replace('Chapter_', ''), 10);
      current = { id, title: `第${cnNum(id)}章`, paras: [] };
      continue;
    }

    if (current && t) current.paras.push(t);
  }
  if (current) chaps.push(current);

  // 按章号排序
  chaps.sort((a, b) => a.id - b.id);

  // 应用该书的标题表
  for (const c of chaps) {
    const t = book.chapterTitles[c.id];
    if (t) {
      c.title = `第${cnNum(c.id)}章 ${t}`;
    }
  }

  return chaps.map(c => ({ id: c.id, title: c.title, paras: c.paras }));
}

/* ---------- 渲染 ---------- */
function renderToc() {
  const list = $('tocList');
  list.innerHTML = '';
  bookChapters.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'toc-item';
    btn.textContent = c.title;
    btn.addEventListener('click', () => goTo(i));
    list.appendChild(btn);
  });
}

function renderChapter(i) {
  if (!bookChapters[i]) return;
  currentChapter = i;
  localStorage.setItem(CHAP_KEY + '_' + currentBook.id, i);
  const c = bookChapters[i];
  $('chapterTitle').textContent = c.title;
  $('searchResult').classList.add('hidden');
  $('chapterBody').classList.remove('hidden');

  const body = $('chapterBody');
  body.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = c.title;
  body.appendChild(h);

  c.paras.forEach(p => {
    // 分隔线样式
    if (/^[*＊]{5,}$/.test(p)) {
      const br = document.createElement('div');
      br.className = 'chapter-break';
      br.textContent = '✦ ✦ ✦';
      body.appendChild(br);
      return;
    }
    const el = document.createElement('p');
    el.textContent = p;
    body.appendChild(el);
  });

  // 更新目录高亮 + 上/下章按钮
  document.querySelectorAll('.toc-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
  });
  $('prevChapter').disabled = i === 0;
  $('nextChapter').disabled = i === bookChapters.length - 1;

  body.scrollTop = 0;
  updateProgress();
}

function updateProgress() {
  const total = bookChapters.length;
  $('progressHint').textContent = `已读 ${currentChapter + 1} / ${total} 章`;
}

/* ---------- 阅读操作 ---------- */
function goTo(i) {
  if (i >= 0 && i < bookChapters.length) {
    renderChapter(i);
    closeSidebar();   // 移动端点章后收起抽屉
  }
}
function nextChapter() { goTo(currentChapter + 1); }
function prevChapter() { goTo(currentChapter - 1); }

/* ---------- 移动端侧边栏抽屉 ---------- */
function openSidebar() {
  document.querySelector('.sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('show');
}
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}
function setupSidebar() {
  const menuBtn = $('menuBtn');
  const backdrop = document.getElementById('sidebarBackdrop');
  menuBtn.addEventListener('click', () => {
    const open = document.querySelector('.sidebar').classList.contains('open');
    open ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);
}

/* ---------- 全文搜索 ---------- */
let searchTimer = null;
function setupSearch() {
  $('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => q ? doSearch(q) : hideSearch(), 300);
  });
}
function doSearch(q) {
  const hits = [];
  bookChapters.forEach(c => {
    const idxs = [];
    const text = c.paras.join('\n');
    let pos = 0;
    while ((pos = text.indexOf(q, pos)) !== -1) { idxs.push(pos); pos += q.length; }
    if (idxs.length) hits.push({ chapter: c, count: idxs.length });
  });

  const box = $('searchResult');
  box.innerHTML = '';
  const h3 = document.createElement('h3');
  h3.textContent = hits.length ? `找到 ${hits.reduce((s, h) => s + h.count, 0)} 处 · 共 ${hits.length} 章` : `未找到「${q}」`;
  box.appendChild(h3);

  hits.slice(0, 30).forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'search-hit';
    const firstIdx = h.chapter.paras.join('\n').indexOf(q);
    const paraIdx = h.chapter.paras.findIndex(p => p.includes(q));
    const para = h.chapter.paras[paraIdx] || '';
    const start = Math.max(0, para.indexOf(q) - 20);
    const excerpt = para.slice(start, start + 80);
    btn.innerHTML = `<span class="hit-chapter">${h.chapter.title}</span><br>`
      + excerpt.replace(q, `<mark>${q}</mark>`) + ` <em>…${h.count}处</em>`;
    btn.addEventListener('click', () => {
      renderChapter(bookChapters.indexOf(h.chapter));
      setTimeout(() => {
        const body = $('chapterBody');
        const target = body.querySelector('p');
        if (target) target.scrollIntoView({ block: 'start' });
      }, 50);
    });
    box.appendChild(btn);
  });

  $('chapterBody').classList.add('hidden');
  box.classList.remove('hidden');
}
function hideSearch() {
  $('searchResult').classList.add('hidden');
  $('chapterBody').classList.remove('hidden');
}

/* ---------- 字体 & 主题 ---------- */
function applyFontSize() {
  const size = parseInt(localStorage.getItem(FONT_KEY) || '17', 10);
  $('chapterBody').style.fontSize = size + 'px';
}
function changeFont(delta) {
  let size = parseInt(localStorage.getItem(FONT_KEY) || '17', 10) + delta;
  size = Math.min(26, Math.max(13, size));
  localStorage.setItem(FONT_KEY, size);
  applyFontSize();
}
function applyTheme() {
  const dark = localStorage.getItem(THEME_KEY) === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('themeToggle').textContent = dark ? '☀️' : '🌙';
}
function toggleTheme() {
  const dark = localStorage.getItem(THEME_KEY) !== 'dark';
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  applyTheme();
}

/* ---------- 书切换(自定义下拉) ---------- */
const BOOK_ICONS = { baijie: '📕', zhangmin: '📗' };
function setupBookSelect() {
  const btn = $('bookSelect');
  const list = $('bookDropdownList');
  const label = $('bookSelectLabel');

  // 渲染选项
  list.innerHTML = '';
  BOOKS.forEach(b => {
    const item = document.createElement('button');
    item.className = 'book-dropdown-item';
    item.dataset.id = b.id;
    item.innerHTML = `<span class="book-icon">${BOOK_ICONS[b.id] || '📖'}</span><span>${b.title}</span>`;
    item.addEventListener('click', () => {
      closeBookDropdown();
      if (b.id !== currentBook.id) loadBook(b);
    });
    list.appendChild(item);
  });

  // 开关
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = $('bookDropdown').classList.contains('hidden');
    open ? openBookDropdown() : closeBookDropdown();
  });
  // 点击外部关闭
  document.addEventListener('click', closeBookDropdown);
}

function openBookDropdown() {
  $('bookSelect').classList.add('open');
  $('bookDropdown').classList.remove('hidden');
}
function closeBookDropdown() {
  $('bookSelect').classList.remove('open');
  $('bookDropdown').classList.add('hidden');
}

function loadBook(book) {
  currentBook = book;
  currentChapter = 0;
  const raw = allBooks[book.id];
  if (!raw) return;
  bookChapters = parseChapters(raw, book);
  if (!bookChapters.length) return;
  $('bookSelectLabel').textContent = `${BOOK_ICONS[book.id] || '📖'} ${book.title}`;
  // 高亮当前项
  document.querySelectorAll('.book-dropdown-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === book.id);
  });
  renderToc();
  const key = CHAP_KEY + '_' + book.id;
  const saved = parseInt(localStorage.getItem(key) || '0', 10);
  goTo(Math.min(saved, bookChapters.length - 1));
  closeSidebar();
  closeBookDropdown();
}

/* ---------- 解锁流程 ---------- */
async function unlock(token) {
  try {
    showLoading('正在验证密钥并从私有仓库读取内容…');
    // 读取所有书
    for (const b of BOOKS) {
      const raw = await fetchBookFile(token, b.file);
      allBooks[b.id] = raw;
    }
    setToken(token);
    hideLoading();
    overlay.classList.add('hidden');
    reader.classList.remove('hidden');
    setupBookSelect();
    loadBook(currentBook);
  } catch (err) {
    hideLoading();
    $('authError').textContent = '❌ ' + err.message;
  }
}

/* ---------- 初始化 ---------- */
function init() {
  applyTheme();
  applyFontSize();
  $('fontPlus').addEventListener('click', () => changeFont(1));
  $('fontMinus').addEventListener('click', () => changeFont(-1));
  $('themeToggle').addEventListener('click', toggleTheme);
  $('nextChapter').addEventListener('click', nextChapter);
  $('prevChapter').addEventListener('click', prevChapter);
  setupSearch();
  setupSidebar();

  $('authBtn').addEventListener('click', () => {
    const t = $('tokenInput').value.trim();
    if (!t) { $('authError').textContent = '❌ 请输入 token'; return; }
    unlock(t);
  });
  $('tokenInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('authBtn').click();
  });
  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  // 已有 token 自动解锁
  const savedToken = getToken();
  if (savedToken) {
    unlock(savedToken);
  }
}

document.addEventListener('DOMContentLoaded', init);
