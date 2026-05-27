import { App, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import type { ContextGeneratorSettings } from "./types";

// Interface minimale pour éviter la dépendance circulaire avec main.ts.
// PluginSettingTab requiert un Plugin, donc IContextPlugin extends Plugin.
interface IContextPlugin extends Plugin {
    settings: ContextGeneratorSettings;
    saveSettings(): Promise<void>;
    getCanvasFiles(): TFile[];
    generateContext(): Promise<void>;
}

export const DEFAULT_SETTINGS: ContextGeneratorSettings = {
    projectPath: "../",
    canvasFile: "",
    outputFile: "CONTEXT.md",
};

export class ContextGeneratorSettingTab extends PluginSettingTab {
    private readonly plugin: IContextPlugin;

    constructor(app: App, plugin: IContextPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Canvas principal")
            .setDesc("Le fichier .canvas à utiliser pour générer le contexte.")
            .addDropdown((dropdown) => {
                const files = this.plugin.getCanvasFiles();
                if (files.length === 0) {
                    dropdown.addOption("", "Aucun canvas trouvé");
                } else {
                    dropdown.addOption("", "-- Choisir un canvas --");
                    files.forEach((f) => dropdown.addOption(f.path, f.basename));
                }
                dropdown.setValue(this.plugin.settings.canvasFile);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.canvasFile = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Chemin du projet")
            .setDesc("Chemin relatif depuis le vault vers la racine du projet. Défaut : ../ (dossier parent).")
            .addText((text) =>
                text
                    .setPlaceholder("../")
                    .setValue(this.plugin.settings.projectPath)
                    .onChange(async (value) => {
                        this.plugin.settings.projectPath = value || "../";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Fichier de sortie")
            .setDesc("Nom du fichier généré à la racine du projet.")
            .addText((text) =>
                text
                    .setPlaceholder("CONTEXT.md")
                    .setValue(this.plugin.settings.outputFile)
                    .onChange(async (value) => {
                        this.plugin.settings.outputFile = value || "CONTEXT.md";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Générer maintenant")
            .setDesc("Lance la génération du contexte immédiatement.")
            .addButton((btn) =>
                btn
                    .setButtonText("Générer")
                    .setCta()
                    .onClick(() => this.plugin.generateContext())
            );
    }
}
