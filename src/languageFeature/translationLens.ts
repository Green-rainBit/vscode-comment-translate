import { CodeLens, CodeLensProvider, DecorationOptions, env, EventEmitter, ExtensionContext, languages, Range, TextEditor, TextEditorDecorationType, commands, window } from "vscode";

interface ActiveTranslation {
    uri: string;
    line: number;
    decoration: TextEditorDecorationType;
    timer: ReturnType<typeof setTimeout>;
}

// key = `${uri}:${line}` -> active translation shown via placeholder + floated decoration
const active = new Map<string, ActiveTranslation>();
let changeEmitter: EventEmitter<void>;

export function registerTranslationLens(context: ExtensionContext) {
    changeEmitter = new EventEmitter<void>();

    context.subscriptions.push(
        commands.registerCommand('commentTranslate._copyLensText', async (text: string) => {
            if (text) await env.clipboard.writeText(text);
        })
    );

    const provider: CodeLensProvider = {
        onDidChangeCodeLenses: changeEmitter.event,
        provideCodeLenses(document): CodeLens[] {
            const lenses: CodeLens[] = [];
            for (const a of active.values()) {
                if (a.uri !== document.uri.toString()) continue;
                if (a.line >= document.lineCount) continue;
                // Placeholder lens reserves vertical space (blank line) so the
                // floated styled decoration below renders without overlapping code.
                lenses.push(new CodeLens(new Range(a.line, 0, a.line, 0), {
                    title: ' ',
                    command: '',
                }));
            }
            return lenses;
        }
    };

    context.subscriptions.push(languages.registerCodeLensProvider({ scheme: 'file' }, provider));
    context.subscriptions.push(languages.registerCodeLensProvider({ scheme: 'untitled' }, provider));
}

/**
 * Show a translation on its own line directly below the selection.
 * Uses a placeholder CodeLens to reserve a blank line, then floats a styled
 * (italic, grey, full-size) decoration into that space — so the text is larger
 * than a normal CodeLens and never overlaps code or the selection highlight.
 */
export function showTranslationBelow(
    editor: TextEditor,
    selectionEndLine: number,
    display: string,
    timeoutMs: number = 15000
) {
    if (!changeEmitter) return;
    const uri = editor.document.uri.toString();
    const line = Math.min(Math.max(0, editor.document.lineCount - 1), selectionEndLine + 1);
    const key = `${uri}:${line}`;

    // Clear ALL existing translations so only one result box is shown at a time.
    // (Prevents duplicates when translate is triggered repeatedly via lightbulb /
    // context menu on the same or different selections.)
    for (const [k, entry] of active) {
        clearTimeout(entry.timer);
        entry.decoration.dispose();
        active.delete(k);
    }

    const decoration = window.createTextEditorDecorationType({});
    const opts: DecorationOptions = {
        range: new Range(line, 0, line, 0),
        renderOptions: {
            before: {
                // Same style as immersive reading (browse mode): floated up into the
                // reserved line, grey, full editor font size.
                textDecoration: `none; font-size: 1em; display: inline-block; position: relative; width: 0; top: -1.3em;`,
                contentText: display,
                color: 'var(--vscode-editorCodeLens-foreground)',
            },
        },
    };
    editor.setDecorations(decoration, [opts]);

    const timer = setTimeout(() => {
        decoration.dispose();
        active.delete(key);
        changeEmitter.fire();
    }, timeoutMs);

    active.set(key, { uri, line, decoration, timer });
    changeEmitter.fire();
}
