import { window, Selection, DecorationOptions, Hover, MarkdownString, commands } from "vscode";
import { ICommentBlock } from "../interface";
import { compileBlock } from "../syntax/compile";
import { createHoverMarkdownString } from "../languageFeature/hoverUtil";
import { showTranslationBelow } from "../languageFeature/translationLens";
import { getMarkdownTextValue } from "../syntax/marked";
import { outputChannel } from "../extension";

export async function translateSelectionCommand() {
    let editor = window.activeTextEditor;

    if (!editor || !editor.document) {
        outputChannel.append(`[translateSelection] No active editor!\n`);
        return;
    }

    let hasSelection = editor.selection && !editor.selection.isEmpty;
    let text: string;
    let selection: Selection;

    if (hasSelection) {
        // Mode 1: Translate selected text
        selection = editor.selection;
        text = editor.document.getText(selection);
        if (!text.trim()) {
            outputChannel.append(`[translateSelection] Selected text is empty!\n`);
            return;
        }

        outputChannel.append(`[translateSelection] Translating selection: "${text.substring(0, 80)}..."\n`);

        // Build the same ICommentBlock as hover's selectionContains() would produce
        let block: ICommentBlock = {
            range: selection,
            comment: text,
        };

        let translatedBlock;
        try {
            translatedBlock = await compileBlock(block, editor.document.languageId);
        } catch (e: any) {
            outputChannel.append(`[translateSelection] Translation failed: ${e.toString()}\n`);
            return;
        }

        let { translatedText, humanizeText, translateLink } = translatedBlock;
        if (!translatedText || translatedText === text) {
            outputChannel.append(`[translateSelection] No translation result.\n`);
            return;
        }

        let res = createHoverMarkdownString(
            translatedText,
            humanizeText,
            editor.document.uri.toString(),
            selection,
            editor.document,
            translateLink
        );

        let showText = humanizeText ? `${humanizeText} → ${translatedText}` : translatedText;

        // Show the translation on its OWN line directly below the selection via a
        // CodeLens (reserves vertical space, never overlaps code or selection).
        showTranslationBelow(
            editor.document.uri.toString(),
            selection.end.line,
            showText,
            translatedText
        );

        // Hover-message-only decoration: hovering the selection shows action buttons.
        // No visible inline text (the CodeLens handles the visible translation).
        let contentDecoration: DecorationOptions = {
            range: selection,
            hoverMessage: [res.header, res.md],
        };

        let translatedDecoration = window.createTextEditorDecorationType({});
        editor.setDecorations(translatedDecoration, [contentDecoration]);

        // Note: we intentionally do NOT auto-trigger the native hover here.
        // The translation is shown via the CodeLens below; the hover buttons are
        // available on-demand when the user moves the mouse over the selection.

        setTimeout(() => { translatedDecoration.dispose(); }, 15000);

    } else {
        // Mode 2: No selection — translate hover content at cursor (e.g. function docs)
        let position = editor.selection.active;

        outputChannel.append(`[translateSelection] Fetching hover at ${position.line}:${position.character}...\n`);

        let hovers: Hover[];
        try {
            hovers = await commands.executeCommand<Hover[]>(
                'vscode.executeHoverProvider',
                editor.document.uri,
                position
            );
        } catch (e: any) {
            outputChannel.append(`[translateSelection] Failed to get hover: ${e.toString()}\n`);
            return;
        }

        if (!hovers || hovers.length === 0) {
            outputChannel.append(`[translateSelection] No hover content at this position.\n`);
            return;
        }

        // Collect and translate each hover's content
        let range: Selection | undefined;
        let translatedMarkdowns: MarkdownString[] = [];
        let originalTexts: string[] = [];

        for (let hover of hovers) {
            if (!hover.range) continue;
            range = range || new Selection(hover.range.start, hover.range.end);

            // Extract text from each content item
            let markdownStrs: string[] = [];
            for (let c of hover.contents) {
                let mdStr: string;
                if (typeof c === 'string') {
                    mdStr = c;
                } else if (c instanceof MarkdownString) {
                    mdStr = c.value;
                } else {
                    mdStr = (c as { language: string; value: string }).value;
                }
                markdownStrs.push(mdStr);
                originalTexts.push(mdStr);
            }

            // Translate each markdown chunk
            let tasks = markdownStrs.map(s => getMarkdownTextValue(s));
            let results = await Promise.all(tasks);

            results.forEach((r) => {
                let translatedMd = new MarkdownString(r.result, true);
                translatedMd.isTrusted = true;
                translatedMarkdowns.push(translatedMd);
            });
        }

        if (!range) {
            outputChannel.append(`[translateSelection] No valid hover range.\n`);
            return;
        }

        outputChannel.append(`[translateSelection] Translated ${translatedMarkdowns.length} hover chunk(s).\n`);

        // Show translated hover as inline decoration + hoverMessage
        let briefText: string;
        if (originalTexts.length > 0) {
            let firstOrig = originalTexts[0].substring(0, 50);
            briefText = `↪ ${firstOrig}...`;
        } else {
            briefText = '↪ ...';
        }

        let contentDecoration: DecorationOptions = {
            range: range,
            renderOptions: {
                after: {
                    textDecoration: `none; font-style: italic;`,
                    contentText: briefText,
                    color: 'var(--vscode-editorCodeLens-foreground)',
                    margin: '0 0 0 0.5em',
                },
            },
            hoverMessage: translatedMarkdowns,
        };

        let translatedDecoration = window.createTextEditorDecorationType({});
        editor.setDecorations(translatedDecoration, [contentDecoration]);

        setTimeout(() => { translatedDecoration.dispose(); }, 15000);
    }
}
