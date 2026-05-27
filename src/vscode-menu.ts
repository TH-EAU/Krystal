import { App, FileSystemAdapter, Menu, Notice, TAbstractFile, TFile } from "obsidian";
import * as path from "path";
import { parseFrontmatter } from "./context-builder";
import type { ContextGeneratorSettings } from "./types";

export function createVSCodeMenuHandler(
    app: App,
    settings: ContextGeneratorSettings,
    iconId: string
): (menu: Menu, file: TAbstractFile) => void {
    return (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) => {
            item
                .setTitle("Ouvrir dans VS Code")
                .setIcon(iconId)
                .onClick(async () => {
                    const raw = await app.vault.read(file);
                    const frontmatter = parseFrontmatter(raw);

                    if (!frontmatter.file) {
                        new Notice("⚠️ Aucun fichier source défini dans le frontmatter.");
                        return;
                    }

                    const { adapter } = app.vault;
                    const vaultPath =
                        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
                    const absPath = path.join(
                        path.resolve(vaultPath, settings.projectPath),
                        frontmatter.file
                    );
                    window.open(`vscode://file/${absPath}`);
                });
        });
    };
}
