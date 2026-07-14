import { CodeLens, CodeLensProvider, commands, env, EventEmitter, ExtensionContext, languages, Range, TextDocument } from "vscode";

interface LensEntry {
    line: number;
    display: string;
    copy: string;
}

// Active translation lenses per document URI
const activeLenses = new Map<string, LensEntry[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let changeEmitter: EventEmitter<void>;

export function registerTranslationLens(context: ExtensionContext) {
    changeEmitter = new EventEmitter<void>();

    // Click a translation lens to copy it
    context.subscriptions.push(
        commands.registerCommand('commentTranslate._copyLensText', async (text: string) => {
            if (text) {
                await env.clipboard.writeText(text);
            }
        })
    );

    const provider: CodeLensProvider = {
        onDidChangeCodeLenses: changeEmitter.event,
        provideCodeLenses(document: TextDocument): CodeLens[] {
            const entries = activeLenses.get(document.uri.toString());
            if (!entries || entries.length === 0) return [];
            const lenses: CodeLens[] = [];
            for (const e of entries) {
                // Lens renders ABOVE range.start.line, so attach to the line after
                // the selection to make it appear directly below the selected text.
                if (e.line >= document.lineCount) continue;
                const range = new Range(e.line, 0, e.line, 0);
                lenses.push(new CodeLens(range, {
                    title: e.display,
                    command: 'commentTranslate._copyLensText',
                    arguments: [e.copy],
                }));
            }
            return lenses;
        }
    };

    context.subscriptions.push(languages.registerCodeLensProvider({ scheme: 'file' }, provider));
    context.subscriptions.push(languages.registerCodeLensProvider({ scheme: 'untitled' }, provider));
}

/**
 * Show a translation as a CodeLens on its own line directly below the selection.
 * @param uri Document URI string
 * @param selectionEndLine The last line number of the selection
 * @param display Text shown in the lens
 * @param copyText Text copied when the lens is clicked
 */
export function showTranslationBelow(
    uri: string,
    selectionEndLine: number,
    display: string,
    copyText: string,
    timeoutMs: number = 15000
) {
    if (!changeEmitter) return;
    const lensLine = selectionEndLine + 1;

    let entries = activeLenses.get(uri) || [];
    entries = entries.filter(e => e.line !== lensLine);
    entries.push({ line: lensLine, display, copy: copyText });
    activeLenses.set(uri, entries);
    changeEmitter.fire();

    const key = `${uri}:${lensLine}`;
    const old = timers.get(key);
    if (old) clearTimeout(old);
    timers.set(key, setTimeout(() => {
        let arr = activeLenses.get(uri);
        if (arr) {
            arr = arr.filter(e => e.line !== lensLine);
            if (arr.length === 0) activeLenses.delete(uri);
            else activeLenses.set(uri, arr);
            changeEmitter.fire();
        }
        timers.delete(key);
    }, timeoutMs));
}

export function clearTranslationBelow(uri: string, selectionEndLine: number) {
    if (!changeEmitter) return;
    const lensLine = selectionEndLine + 1;
    let arr = activeLenses.get(uri);
    if (arr) {
        arr = arr.filter(e => e.line !== lensLine);
        if (arr.length === 0) activeLenses.delete(uri);
        else activeLenses.set(uri, arr);
        changeEmitter.fire();
    }
    const key = `${uri}:${lensLine}`;
    const t = timers.get(key);
    if (t) { clearTimeout(t); timers.delete(key); }
}
