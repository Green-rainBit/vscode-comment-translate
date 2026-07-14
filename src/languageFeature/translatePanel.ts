import { commands, ExtensionContext, StatusBarAlignment, window, WebviewView } from "vscode";
import { LANGS } from "../lang";
import { autoMutualTranslate, cachedTranslate, getUserLanguage } from "../translate/manager";
import { getConfig } from "../configuration";
import { outputChannel } from "../extension";

let currentView: WebviewView | undefined;

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function buildLangOptions(selected: string): string {
    return LANGS.map(([code, name]) =>
        `<option value="${code}" ${code === selected ? 'selected' : ''}>${name}</option>`
    ).join('');
}

function getWebviewContent(nonce: string, sourceLang: string, targetLang: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Comment Translate</title>
<style>
    :root {
        --bg: var(--vscode-editor-background, #ffffff);
        --fg: var(--vscode-editor-foreground, #333333);
        --fg-muted: var(--vscode-descriptionForeground, #666666);
        --border: var(--vscode-panel-border, #e0e0e0);
        --accent: var(--vscode-button-background, #4a4a9c);
        --accent-fg: var(--vscode-button-foreground, #ffffff);
        --input-bg: var(--vscode-input-background, #f8f8f8);
        --hover: var(--vscode-list-hoverBackground, #f0f0f0);
        --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);
        font-size: 13px;
        color: var(--fg);
        background: var(--bg);
        height: 100vh;
        display: flex;
        flex-direction: column;
        padding: 12px;
        overflow: hidden;
    }
    .lang-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 0 0 12px;
        flex-shrink: 0;
    }
    .lang-bar select {
        flex: 1;
        max-width: 260px;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--input-bg);
        color: var(--fg);
        font-size: 13px;
        cursor: pointer;
        outline: none;
    }
    .lang-bar select:focus { border-color: var(--accent); }
    .swap-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid var(--border);
        background: var(--bg);
        color: var(--fg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.15s;
    }
    .swap-btn:hover { background: var(--hover); }
    .panels {
        display: flex;
        flex: 1;
        gap: 12px;
        min-height: 0;
    }
    .panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--input-bg);
        min-width: 0;
    }
    .panel-header {
        padding: 8px 12px;
        font-weight: 600;
        font-size: 13px;
        color: var(--fg);
        border-bottom: 1px solid var(--border);
        background: var(--bg);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
    }
    .panel-body {
        flex: 1;
        position: relative;
        display: flex;
        min-height: 0;
    }
    textarea, .output {
        flex: 1;
        width: 100%;
        padding: 12px;
        border: none;
        background: transparent;
        color: var(--fg);
        font-family: var(--vscode-editor-font-family, inherit);
        font-size: 14px;
        line-height: 1.6;
        resize: none;
        outline: none;
    }
    textarea::placeholder { color: var(--fg-muted); }
    .output {
        white-space: pre-wrap;
        word-break: break-word;
        overflow-y: auto;
        user-select: text;
    }
    .output.loading::after {
        content: '翻译中…';
        color: var(--fg-muted);
        font-style: italic;
    }
    .output.empty { color: var(--fg-muted); font-style: italic; }
    .panel-footer {
        padding: 4px 12px;
        font-size: 11px;
        color: var(--fg-muted);
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--bg);
        flex-shrink: 0;
    }
    .icon-btn {
        background: none;
        border: none;
        color: var(--fg-muted);
        cursor: pointer;
        padding: 2px 6px;
        font-size: 13px;
        border-radius: 4px;
    }
    .icon-btn:hover { color: var(--fg); background: var(--hover); }
    .toolbar { display: flex; gap: 4px; }
    .translate-btn {
        background: var(--accent);
        color: var(--accent-fg);
        border: none;
        padding: 4px 14px;
        border-radius: var(--radius);
        cursor: pointer;
        font-size: 12px;
    }
    .translate-btn:hover { opacity: 0.9; }
    .arrow { font-size: 16px; }
</style>
</head>
<body>
    <div class="lang-bar">
        <select id="sourceLang">${buildLangOptions(sourceLang)}</select>
        <button class="swap-btn" id="swapBtn" title="交换语言"><span class="arrow">⇄</span></button>
        <select id="targetLang">${buildLangOptions(targetLang)}</select>
    </div>
    <div class="panels">
        <div class="panel">
            <div class="panel-header"><span id="leftHeader">输入文本</span></div>
            <div class="panel-body"><textarea id="input" placeholder="输入文本，自动翻译到右侧…" autofocus></textarea></div>
            <div class="panel-footer">
                <span id="charCount">0 / 5000</span>
                <div class="toolbar"><button class="icon-btn" id="clearBtn" title="清空">🗑</button></div>
            </div>
        </div>
        <div class="panel">
            <div class="panel-header">
                <span id="rightHeader">翻译</span>
                <button class="translate-btn" id="translateBtn">翻译</button>
            </div>
            <div class="panel-body"><textarea id="output" placeholder="或在此输入，自动翻译到左侧…"></textarea></div>
            <div class="panel-footer">
                <span id="status"></span>
                <div class="toolbar"><button class="icon-btn" id="copyBtn" title="复制右侧">📋</button></div>
            </div>
        </div>
    </div>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const output = document.getElementById('output');
    const sourceLang = document.getElementById('sourceLang');
    const targetLang = document.getElementById('targetLang');
    const swapBtn = document.getElementById('swapBtn');
    const clearBtn = document.getElementById('clearBtn');
    const copyBtn = document.getElementById('copyBtn');
    const translateBtn = document.getElementById('translateBtn');
    const charCount = document.getElementById('charCount');
    const status = document.getElementById('status');
    const leftHeader = document.getElementById('leftHeader');
    const rightHeader = document.getElementById('rightHeader');
    // Which side currently has focus / should be treated as the source
    let focusedSide = 'left';
    // Guard against the feedback loop: when we programmatically fill a side,
    // set this true and reset on the next tick so any input event dispatched by
    // the value change is ignored (input events are dispatched asynchronously).
    let suppressInput = false;
    let debounceTimer = null;

    function langLabel(sel) {
        return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    }
    function updateHeaders() {
        leftHeader.textContent = langLabel(sourceLang);
        rightHeader.textContent = langLabel(targetLang);
    }
    function updateCharCount() {
        const n = focusedSide === 'left' ? input.value.length : output.value.length;
        charCount.textContent = n + ' / 5000';
    }
    updateHeaders();

    // Translate from the given side to the other.
    // side === 'left'  -> sourceLang -> targetLang, result fills right
    // side === 'right' -> targetLang -> sourceLang, result fills left
    function requestTranslate(side) {
        const srcEl = side === 'left' ? input : output;
        const text = srcEl.value.trim();
        if (!text) return;
        const from = side === 'left' ? sourceLang.value : targetLang.value;
        const to = side === 'left' ? targetLang.value : sourceLang.value;
        status.textContent = '翻译中… ' + from + ' → ' + to;
        vscode.postMessage({ command: 'translate', text, from, to, fromSide: side });
    }
    function debounceTranslate(side) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => requestTranslate(side), 400);
    }

    // Focus tracking: translate from whichever side the user is working on
    input.addEventListener('focus', () => { focusedSide = 'left'; updateCharCount(); });
    output.addEventListener('focus', () => { focusedSide = 'right'; updateCharCount(); });
    // Auto-translate on input, guarded so programmatic fills never loop back
    input.addEventListener('input', () => {
        updateCharCount();
        if (suppressInput) return;
        focusedSide = 'left';
        debounceTranslate('left');
    });
    output.addEventListener('input', () => {
        updateCharCount();
        if (suppressInput) return;
        focusedSide = 'right';
        debounceTranslate('right');
    });

    // Translate button: uses the focused side (default left)
    translateBtn.addEventListener('click', () => requestTranslate(focusedSide));

    // Ctrl/Cmd + Enter on either textarea to translate from that side
    input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); requestTranslate('left'); }
    });
    output.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); requestTranslate('right'); }
    });

    sourceLang.addEventListener('change', () => { updateHeaders(); });
    targetLang.addEventListener('change', () => { updateHeaders(); });
    swapBtn.addEventListener('click', () => {
        const s = sourceLang.value;
        sourceLang.value = targetLang.value;
        targetLang.value = s;
        suppressInput = true;
        const tmp = input.value;
        input.value = output.value;
        output.value = tmp;
        setTimeout(() => { suppressInput = false; }, 0);
        updateHeaders();
    });
    clearBtn.addEventListener('click', () => {
        suppressInput = true;
        input.value = '';
        output.value = '';
        setTimeout(() => { suppressInput = false; }, 0);
        charCount.textContent = '0 / 5000';
        status.textContent = '';
        input.focus();
    });
    copyBtn.addEventListener('click', () => {
        const text = output.value;
        if (text) {
            navigator.clipboard.writeText(text).then(() => {
                status.textContent = '已复制';
                setTimeout(() => status.textContent = '', 1500);
            });
        }
    });
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'result') {
            // Fill the opposite side with the guard so it never re-triggers translation
            const el = msg.target === 'right' ? output : input;
            if (el.value !== msg.text) {
                suppressInput = true;
                el.value = msg.text;
                // Defer reset: input events are dispatched asynchronously, so this
                // flag stays true long enough to swallow them.
                setTimeout(() => { suppressInput = false; }, 0);
            }
            status.textContent = msg.from + ' → ' + msg.to;
        } else if (msg.command === 'error') {
            status.textContent = '翻译失败: ' + msg.error;
        }
    });
    input.focus();
</script>
</body>
</html>`;
}

export function registerTranslatePanel(context: ExtensionContext) {
    // Status bar button at bottom-RIGHT
    const statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    statusBarItem.command = 'commentTranslate.openTranslatePanel';
    statusBarItem.text = '$(globe)';
    statusBarItem.tooltip = '打开翻译面板';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        commands.registerCommand('commentTranslate.openTranslatePanel', async () => {
            try {
                await commands.executeCommand('commentTranslate.translatePanelView.focus');
            } catch {
                await commands.executeCommand('workbench.view.extension.commentTranslate.panelContainer');
            }
        })
    );

    context.subscriptions.push(
        window.registerWebviewViewProvider(
            'commentTranslate.translatePanelView',
            {
                resolveWebviewView(view: WebviewView) {
                    currentView = view;
                    const userLanguage = getUserLanguage();
                    const defaultTarget = getConfig<string>('targetLanguage', userLanguage) || 'zh-CN';
                    const defaultSource = getConfig<string>('sourceLanguage', 'auto') || 'auto';
                    view.webview.options = { enableScripts: true };
                    view.webview.html = getWebviewContent(getNonce(), defaultSource, defaultTarget);

                    view.webview.onDidReceiveMessage(async (message) => {
                        if (message.command === 'translate') {
                            try {
                                let opts: any = {};
                                if (message.from && message.from !== 'auto') opts.from = message.from;
                                if (message.to) opts.to = message.to;
                                let result;
                                if (message.from && message.from !== 'auto') {
                                    result = await cachedTranslate(message.text, opts);
                                } else {
                                    result = await autoMutualTranslate(message.text, opts);
                                }
                                // Fill the opposite side from where the user typed
                                const target = message.fromSide === 'left' ? 'right' : 'left';
                                currentView?.webview.postMessage({
                                    command: 'result',
                                    text: result,
                                    target,
                                    from: message.from || 'auto',
                                    to: message.to
                                });
                            } catch (e: any) {
                                outputChannel.append(`[translatePanel] Translation failed: ${e.toString()}\n`);
                                currentView?.webview.postMessage({
                                    command: 'error',
                                    error: e.message || e.toString()
                                });
                            }
                        }
                    });

                    view.onDidDispose(() => { currentView = undefined; });
                }
            },
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );
}
