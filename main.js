const UI_IDS = {
    root: 'drfrostsolver-root',
    style: 'drfrostsolver-style',
    btnFetch: 'drfrostsolver-btn-fetch',
    btnSubmit: 'drfrostsolver-btn-submit',
    btnCopy: 'drfrostsolver-btn-copy',
    btnClear: 'drfrostsolver-btn-clear',
    answer: 'drfrostsolver-answer',
    log: 'drfrostsolver-log',
    menuAbout: 'drfrostsolver-menu-about',
    menuOpenConsole: 'drfrostsolver-menu-open-console',
    menuClose: 'drfrostsolver-menu-close'
};

const logQueue = [];
let lastAnswer = '';
let lastAnswerRaw = null;
const globalContext = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

function getEl(id) {
    return document.getElementById(id);
}

function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.id) node.id = options.id;
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
    }
    return node;
}

function getJQuery() {
    if (globalContext && typeof globalContext.$ === 'function') return globalContext.$;
    if (typeof $ === 'function') return $;
    return null;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function injectStyles() {
    if (getEl(UI_IDS.style)) return;
    const style = document.createElement('style');
    style.id = UI_IDS.style;
    style.textContent = `
#${UI_IDS.root}{position:fixed;top:16px;right:16px;width:min(360px,92vw);z-index:99999;font-family:"Space Grotesk","Segoe UI",sans-serif;color:#0f172a}
#${UI_IDS.root} *{box-sizing:border-box}
#${UI_IDS.root}{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 12px 34px rgba(11,22,45,0.18)}
#${UI_IDS.root} .dfs-menu-bar{background:linear-gradient(120deg,#fef3c7,#d1fae5);padding:8px 10px;border-bottom:1px solid #e2e8f0;cursor:move;user-select:none;touch-action:none}
#${UI_IDS.root} .dfs-menu{list-style:none;margin:0;padding:0;display:flex;gap:12px}
#${UI_IDS.root} .dfs-menu-item{position:relative;padding:4px 8px;cursor:default;font-size:13px}
#${UI_IDS.root} .dfs-submenu{display:none;position:absolute;left:0;top:100%;background:#ffffff;border:1px solid #e2e8f0;list-style:none;padding:6px 0;margin:6px 0;min-width:140px;border-radius:8px;box-shadow:0 8px 18px rgba(11,22,45,0.12)}
#${UI_IDS.root} .dfs-menu-item:hover>.dfs-submenu{display:block}
#${UI_IDS.root} .dfs-submenu li{padding:6px 10px;cursor:pointer;font-size:12px}
#${UI_IDS.root} .dfs-submenu li:hover{background:#f1f5f9}
#${UI_IDS.root} .dfs-content{padding:12px}
#${UI_IDS.root} .dfs-title{margin:0 0 10px 0;font-size:18px;letter-spacing:.2px}
#${UI_IDS.root} .dfs-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
#${UI_IDS.root} .dfs-btn{background:#0f766e;color:#ffffff;border:none;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px}
#${UI_IDS.root} .dfs-btn-secondary{background:#e6f2f1;color:#0f766e}
#${UI_IDS.root} .dfs-label{font-weight:600;color:#475569;font-size:12px;margin-bottom:6px}
#${UI_IDS.root} .dfs-answer{padding:10px;border:1px dashed #cbd5f5;border-radius:8px;background:#ffffff;min-height:36px;font-size:13px}
#${UI_IDS.root} .dfs-log{background:#0f172a;color:#dbeafe;padding:10px;border-radius:8px;min-height:140px;max-height:200px;overflow:auto;font-size:12px}
#${UI_IDS.root}.dfs-minimized .dfs-content{display:none}
`;
    (document.head || document.documentElement).appendChild(style);
}

function buildGui() {
    if (getEl(UI_IDS.root)) return;
    injectStyles();

    const root = el('div', { id: UI_IDS.root });

    const menuBar = el('div', { className: 'dfs-menu-bar' });
    const menu = el('ul', { className: 'dfs-menu' });

    const fileItem = el('li', { className: 'dfs-menu-item', text: 'File' });
    const fileSub = el('ul', { className: 'dfs-submenu' });
    const menuOpenConsole = el('li', { id: UI_IDS.menuOpenConsole, text: 'Open Console' });
    const menuClose = el('li', { id: UI_IDS.menuClose, text: 'Minimize Panel' });
    fileSub.append(menuOpenConsole, menuClose);
    fileItem.appendChild(fileSub);

    const helpItem = el('li', { className: 'dfs-menu-item', text: 'Help' });
    const helpSub = el('ul', { className: 'dfs-submenu' });
    const menuAbout = el('li', { id: UI_IDS.menuAbout, text: 'About' });
    helpSub.appendChild(menuAbout);
    helpItem.appendChild(helpSub);

    menu.append(fileItem, helpItem);
    menuBar.appendChild(menu);

    const content = el('div', { className: 'dfs-content' });
    const title = el('h1', { className: 'dfs-title', text: 'DrFrost Answer Fetcher' });

    const controls = el('div', { className: 'dfs-controls' });
    const row = el('div', { className: 'dfs-row' });
    const btnFetch = el('button', { id: UI_IDS.btnFetch, className: 'dfs-btn', text: 'Fetch Answer' });
    const btnSubmit = el('button', { id: UI_IDS.btnSubmit, className: 'dfs-btn', text: 'Submit Answer' });
    const btnCopy = el('button', { id: UI_IDS.btnCopy, className: 'dfs-btn dfs-btn-secondary', text: 'Copy Answer' });
    const btnClear = el('button', { id: UI_IDS.btnClear, className: 'dfs-btn dfs-btn-secondary', text: 'Clear Log' });
    row.append(btnFetch, btnSubmit, btnCopy, btnClear);

    const labelAnswer = el('div', { className: 'dfs-label', text: 'Latest Answer:' });
    const answer = el('div', { id: UI_IDS.answer, className: 'dfs-answer', text: lastAnswer || '(no answer yet)' });

    controls.append(row, labelAnswer, answer);

    const logWrap = el('div', { className: 'dfs-log-wrap' });
    const labelLog = el('div', { className: 'dfs-label', text: 'Log:' });
    const log = el('pre', { id: UI_IDS.log, className: 'dfs-log' });
    logWrap.append(labelLog, log);

    content.append(title, controls, logWrap);
    root.append(menuBar, content);
    document.body.appendChild(root);
}

function applyRootPosition(root, x, y) {
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = 'auto';
}

function makeGuiDraggable() {
    const root = getEl(UI_IDS.root);
    if (!root || root.dataset.draggable === '1') return;

    const handle = root.querySelector('.dfs-menu-bar');
    if (!handle) return;

    root.dataset.draggable = '1';
    const storageKey = 'drfrostsolver-panel-pos';

    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const pos = JSON.parse(saved);
            if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                applyRootPosition(root, pos.x, pos.y);
            }
        }
    } catch (err) {
        // Ignore storage errors.
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let rootW = 0;
    let rootH = 0;
    let lastX = 0;
    let lastY = 0;

    const onPointerMove = (event) => {
        if (!dragging) return;
        const maxX = Math.max(8, window.innerWidth - rootW - 8);
        const maxY = Math.max(8, window.innerHeight - rootH - 8);
        const nextX = clamp(event.clientX - offsetX, 8, maxX);
        const nextY = clamp(event.clientY - offsetY, 8, maxY);
        lastX = nextX;
        lastY = nextY;
        applyRootPosition(root, nextX, nextY);
    };

    const onPointerUp = (event) => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        try {
            handle.releasePointerCapture(event.pointerId);
        } catch (err) {
            // ignore release errors
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify({ x: lastX, y: lastY }));
        } catch (err) {
            // ignore storage errors
        }
    };

    const onPointerDown = (event) => {
        if (event.button !== 0) return;
        const rect = root.getBoundingClientRect();
        dragging = true;
        rootW = rect.width;
        rootH = rect.height;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        lastX = rect.left;
        lastY = rect.top;
        applyRootPosition(root, lastX, lastY);
        handle.setPointerCapture(event.pointerId);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        event.preventDefault();
    };

    handle.addEventListener('pointerdown', onPointerDown);
}

function flushLogQueue() {
    const logEl = getEl(UI_IDS.log);
    if (!logEl || logQueue.length === 0) return;
    for (let i = logQueue.length - 1; i >= 0; i -= 1) {
        logEl.textContent = `${logQueue[i]}\n` + logEl.textContent;
    }
    logQueue.length = 0;
}

// UI helper: append log and update answer element
function uiLog(...args) {
    const logEl = getEl(UI_IDS.log);
    const now = new Date().toISOString().slice(11, 23);
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const line = `${now}  ${text}`;
    if (logEl) {
        logEl.textContent = `${line}\n` + logEl.textContent;
    } else {
        logQueue.push(line);
    }
    console.log(...args);
}

function uiSetAnswer(text) {
    if (text !== undefined && text !== null) {
        lastAnswer = String(text);
    }
    const el = getEl(UI_IDS.answer);
    if (el) el.textContent = lastAnswer || '(no answer yet)';
}

function formatAnswerText(raw) {
    if (raw === undefined || raw === null) return '(no answer yet)';
    if (typeof raw === 'string') return raw;
    try {
        return JSON.stringify(raw);
    } catch (err) {
        return String(raw);
    }
}

function normalizeArrayAnswer(value) {
    const isAnswerWrapperObject = (candidate) => candidate
        && typeof candidate === 'object'
        && !Array.isArray(candidate)
        && (Object.prototype.hasOwnProperty.call(candidate, 'main')
            || Object.prototype.hasOwnProperty.call(candidate, 'exact'));

    if (Array.isArray(value)) {
        if (value.length === 1 && isAnswerWrapperObject(value[0])) {
            return normalizeArrayAnswer(value[0]);
        }
        return value.map(normalizeArrayAnswer);
    }
    if (isAnswerWrapperObject(value)) {
        const hasMain = Object.prototype.hasOwnProperty.call(value, 'main');
        const hasExact = Object.prototype.hasOwnProperty.call(value, 'exact');
        const mainValue = hasMain ? value.main : undefined;
        if (hasMain && mainValue !== undefined && mainValue !== null) {
            return normalizeArrayAnswer(mainValue);
        }
        if (hasExact) {
            return normalizeArrayAnswer(value.exact);
        }
        if (hasMain) return normalizeArrayAnswer(mainValue);
    }
    return value;
}

function normalizeUserAnswer(raw) {
    return normalizeArrayAnswer(raw);
}

function getTaskContext() {
    const jq = getJQuery();
    const $taskState = jq ? jq(document).data('taskState') : null;
    const taskState = $taskState || (window.taskState ? window.taskState : null);
    const question = taskState?.question || null;
    const params = taskState?.params || question?.params || null;
    const ssid = question?.subskill?.ssid || taskState?.ssid || null;
    const qnumAttr = document.querySelector('[data-qnum]')?.getAttribute('data-qnum');
    const aaidAttr = document.querySelector('[data-aaid]')?.getAttribute('data-aaid');
    const url = new URL(window.location.href);
    const qnum = taskState?.qnum || question?.qnum || (qnumAttr ? Number(qnumAttr) : null) || (url.searchParams.get('qnum') ? Number(url.searchParams.get('qnum')) : null);
    const aaid = taskState?.aaid || question?.aaid || (aaidAttr ? Number(aaidAttr) : null) || (url.searchParams.get('aaid') ? Number(url.searchParams.get('aaid')) : null);
    const referrer = aaid ? `https://www.drfrost.org/do-question.php?aaid=${aaid}` : window.location.href;

    return {
        taskState,
        question,
        params,
        ssid,
        qnum,
        aaid,
        referrer
    };
}

function overrideSetQNum() {
    if (!globalContext || typeof globalContext.setQNum !== 'function') return false;

    globalContext.setQNum = function(qnum) {
        const jq = getJQuery();
        const state = jq ? jq(document).data('taskState') : (globalContext.taskState || window.taskState);
        if (!state || !state.attempt) {
            uiLog('setQNum override failed: taskState missing');
            return false;
        }

        // Keep these variables aligned with the original function signature.
        var isFixedTask = !!state.task.wid;
        var hasSeenQuestion = !!state.attempt.answers[qnum];

        const feedbackFn = globalContext.isFeedbackRequiredAndNotGiven
            || (typeof isFeedbackRequiredAndNotGiven === 'function' ? isFeedbackRequiredAndNotGiven : null);
        if (typeof feedbackFn === 'function' && feedbackFn()) {
            const alertFn = globalContext.dfmAlert
                || (typeof dfmAlert === 'function' ? dfmAlert : null)
                || alert;
            alertFn('Your teacher has required that you give feedback on your answer.');
            return false;
        }

        var toSend = { aaid: state.attempt.aaid };
        if (qnum) toSend.qnum = qnum;

        if (typeof globalContext.getTaskQuestion === 'function') {
            globalContext.getTaskQuestion(toSend);
        } else if (typeof getTaskQuestion === 'function') {
            getTaskQuestion(toSend);
        }
        return true;
    };

    uiLog('setQNum override installed');
    return true;
}

function installSetQNumOverride() {
    if (overrideSetQNum()) return;

    let attempts = 0;
    const maxAttempts = 40;
    const intervalMs = 500;
    const timer = setInterval(() => {
        attempts += 1;
        const installed = overrideSetQNum();
        if (installed || attempts >= maxAttempts) {
            clearInterval(timer);
            if (!installed) {
                uiLog('setQNum override not installed: function not found');
            }
        }
    }, intervalMs);
}

async function fetchAnswer() {
    try {
        uiLog('Attempting to fetch answer...');

        // 1. Dynamically fetch the current question data from the page's state
        const jq = getJQuery();
        const $taskState = jq ? jq(document).data('taskState') : null;
        const taskState = $taskState || (window.taskState ? window.taskState : null);

        if (!taskState || !taskState.question) {
            uiLog('Task state or question not found. This must run on an active question page.');
            throw new Error('Task state missing');
        }

        const questionObj = taskState.question;

        // 2. Payload (userAnswer set to "1" as preview)
        const payload = {
            userAnswer: '1',
            params: questionObj.params,
            ssid: questionObj.subskill ? questionObj.subskill.ssid : undefined,
            question: questionObj
        };

        uiLog('Sending preview request...');

        // 3. Make the fetch request to the server
        const response = await fetch('https://www.drfrost.org/api/tasks/submitanswer', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/javascript, */*; q=0.01',
                'content-type': 'text/plain;charset=UTF-8',
                'x-requested-with': 'XMLHttpRequest'
            },
            referrer: 'https://www.drfrost.org/worksheets.php?wid=new',
            body: JSON.stringify(payload),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const resultData = await response.json();
        const correctAnswerObj = resultData?.question?.answer?.correctAnswer;
        const rawAnswer = correctAnswerObj && Object.prototype.hasOwnProperty.call(correctAnswerObj, 'main')
            ? correctAnswerObj.main
            : correctAnswerObj;

        lastAnswerRaw = rawAnswer;
        uiLog('Fetched answer:', rawAnswer);
        uiSetAnswer(formatAnswerText(rawAnswer));
        return rawAnswer;
    } catch (err) {
        uiLog('Fetch failed:', err && err.message ? err.message : err);
        throw err;
    }
}

async function copyToClipboard(answerText) {
    const currentAnswer = getEl(UI_IDS.answer)?.textContent;
    const text = String(answerText ?? currentAnswer ?? lastAnswer ?? '');
    if (!text) {
        uiLog('Nothing to copy');
        return false;
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            uiLog('Copied answer to clipboard (Clipboard API)');
            return true;
        }
        throw new Error('Clipboard API not available');
    } catch (apiErr) {
        uiLog('Clipboard API failed, attempting fallback');
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '0';
            textarea.style.left = '0';
            textarea.style.width = '1px';
            textarea.style.height = '1px';
            textarea.style.padding = '0';
            textarea.style.border = 'none';
            textarea.style.outline = 'none';
            textarea.style.boxShadow = 'none';
            textarea.style.background = 'transparent';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (successful) {
                uiLog('Copied answer to clipboard (fallback)');
                return true;
            }

            uiLog('Fallback copy failed. Document may not be focused or browser blocked the copy.');
            return false;
        } catch (fallbackErr) {
            uiLog('Fallback clipboard copy exception:', fallbackErr);
            return false;
        }
    }
}

async function submitAnswer() {
    try {
        uiLog('Preparing submission...');
        const ctx = getTaskContext();

        const hasRawAnswer = lastAnswerRaw !== null && lastAnswerRaw !== undefined && !(typeof lastAnswerRaw === 'string' && lastAnswerRaw.trim() === '');

        if (!hasRawAnswer) {
            uiLog('No cached answer found. Fetching answer first...');
            await fetchAnswer();
        }

        const hasAnswerAfterFetch = lastAnswerRaw !== null && lastAnswerRaw !== undefined && !(typeof lastAnswerRaw === 'string' && lastAnswerRaw.trim() === '');
        if (!hasAnswerAfterFetch) {
            uiLog('Unable to submit: no answer available.');
            return null;
        }

        const missing = [];
        if (!ctx.aaid) missing.push('aaid');
        if (!ctx.qnum) missing.push('qnum');
        if (!ctx.ssid) missing.push('ssid');
        if (!ctx.params) missing.push('params');

        if (missing.length > 0) {
            uiLog('Unable to submit: missing', missing.join(', '));
            return null;
        }

        const userAnswer = normalizeUserAnswer(lastAnswerRaw);
        const payload = {
            userAnswer,
            qnum: ctx.qnum,
            aaid: ctx.aaid,
            ssid: ctx.ssid,
            params: ctx.params
        };

        uiLog('Submitting answer...');
        const response = await fetch('https://www.drfrost.org/api/tasks/submitanswer', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/javascript, */*; q=0.01',
                'content-type': 'text/plain;charset=UTF-8',
                'x-requested-with': 'XMLHttpRequest'
            },
            referrer: ctx.referrer,
            body: JSON.stringify(payload),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const resultData = await response.json();
        const isCorrect = resultData?.iscorrect;
        const points = resultData?.performanceupdate?.pointsearned;
        uiLog('Submit response:', { iscorrect: isCorrect, pointsearned: points });
        return resultData;
    } catch (err) {
        uiLog('Submit failed:', err && err.message ? err.message : err);
        return null;
    }
}

function bindGuiEvents() {
    const root = getEl(UI_IDS.root);
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const btnFetch = getEl(UI_IDS.btnFetch);
    const btnSubmit = getEl(UI_IDS.btnSubmit);
    const btnCopy = getEl(UI_IDS.btnCopy);
    const btnClear = getEl(UI_IDS.btnClear);
    const menuAbout = getEl(UI_IDS.menuAbout);
    const menuOpenConsole = getEl(UI_IDS.menuOpenConsole);
    const menuClose = getEl(UI_IDS.menuClose);

    if (btnFetch) btnFetch.addEventListener('click', async () => {
        try {
            await fetchAnswer();
        } catch (e) {
            // error already logged in fetchAnswer
        }
    });

    if (btnSubmit) btnSubmit.addEventListener('click', async () => {
        await submitAnswer();
    });

    if (btnCopy) btnCopy.addEventListener('click', async () => {
        await copyToClipboard();
    });

    if (btnClear) btnClear.addEventListener('click', () => {
        const logEl = getEl(UI_IDS.log);
        if (logEl) logEl.textContent = '';
    });

    if (menuAbout) menuAbout.addEventListener('click', () => {
        alert('DrFrost Answer Fetcher GUI\nUse on drfrost.org question pages to extract answers.');
    });

    if (menuOpenConsole) menuOpenConsole.addEventListener('click', () => {
        uiLog('Open console requested — press F12 to open devtools in most browsers.');
    });

    if (menuClose) menuClose.addEventListener('click', () => {
        const isMinimized = root.classList.toggle('dfs-minimized');
        uiLog(isMinimized ? 'Panel minimized' : 'Panel restored');
    });
}

function ensureGui() {
    buildGui();
    makeGuiDraggable();
    bindGuiEvents();
    flushLogQueue();
    uiSetAnswer(lastAnswer || '(no answer yet)');
}

function onReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

onReady(() => {
    ensureGui();
    installSetQNumOverride();
    uiLog('GUI ready');
});
