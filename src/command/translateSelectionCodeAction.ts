import { CodeActionProvider, CodeActionKind, CodeAction, TextDocument, Range, Selection, languages, ExtensionContext } from "vscode";

class TranslateSelectionCodeActionProvider implements CodeActionProvider {
    provideCodeActions(document: TextDocument, range: Range | Selection): CodeAction[] {
        // Only trigger when the user has a non-empty selection
        if (range.isEmpty) {
            return [];
        }

        const text = document.getText(range);
        if (!text.trim()) {
            return [];
        }

        const action = new CodeAction("🔤 翻译选中文本", CodeActionKind.Empty);
        action.command = {
            command: "commentTranslate.translateSelection",
            title: "翻译选中文本",
        };
        return [action];
    }
}

export function registerTranslateSelectionCodeAction(context: ExtensionContext) {
    context.subscriptions.push(
        languages.registerCodeActionsProvider(
            "*",
            new TranslateSelectionCodeActionProvider(),
            {
                providedCodeActionKinds: [CodeActionKind.Empty],
            }
        )
    );
}
