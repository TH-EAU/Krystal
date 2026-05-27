import { Plugin, TFile, addIcon } from "obsidian";
import { DEFAULT_SETTINGS, ContextGeneratorSettingTab } from "./settings";
import { ContextBuilder } from "./context-builder";
import { NoteCreator } from "./note-creator";
import { createVSCodeMenuHandler } from "./vscode-menu";
import { ContextImporter } from "./context-importer";
import type { ContextGeneratorSettings } from "./types";

const ICON_ID = "context-generator";

const PLUGIN_ICON = `<svg viewBox="0 0 600 600" fill="none"><path d="M217.143 493.853L202.323 570.821C202.137 571.788 202.682 572.746 203.609 573.08L261.889 594.099C262.574 594.346 263.34 594.201 263.887 593.72L278.922 580.508C279.294 580.181 279.532 579.728 279.589 579.236L284.704 535.054C284.854 533.759 286.184 532.951 287.403 533.415L305.656 540.369C305.883 540.456 306.125 540.5 306.368 540.5H322.246C323.013 540.5 323.712 540.062 324.046 539.371L452.682 273.657C452.887 273.233 452.936 272.749 452.82 272.292L446.384 247.007C446.158 246.12 445.36 245.5 444.445 245.5H404.408C403.156 245.5 402.212 244.363 402.442 243.133L417.34 163.355C417.442 162.81 417.313 162.247 416.983 161.8L402.908 142.731C402.372 142.004 401.416 141.727 400.574 142.054L351.357 161.195C349.894 161.763 348.376 160.503 348.667 158.96L368.893 51.5696C368.963 51.1975 368.926 50.8132 368.786 50.4613L356.293 18.9965C355.864 17.9177 354.611 17.4289 353.565 17.9331L285.872 50.5793C285.321 50.845 284.922 51.3483 284.789 51.9453L270.754 114.86C270.597 115.564 270.073 116.129 269.382 116.339L238.608 125.664C237.923 125.872 237.401 126.43 237.239 127.128L219.479 203.941C219 206.014 216.044 206.004 215.579 203.928L211.665 186.466C211.35 185.063 209.703 184.44 208.539 185.284L171.867 211.871C171.326 212.264 171.016 212.902 171.043 213.571L177.489 374.216C177.496 374.404 177.477 374.593 177.432 374.776L152.978 473.57C152.713 474.638 153.361 475.719 154.427 475.989L215.671 491.536C216.698 491.796 217.344 492.812 217.143 493.853Z" fill="currentColor" opacity="0.3"/><path d="M415.802 168.114L360.942 456.54C360.68 457.92 359.713 459.061 358.395 459.546L346.657 463.867C343.736 464.942 340.761 462.416 341.347 459.36L399.948 153.659C400.635 150.077 405.365 149.207 407.281 152.311L415.276 165.266C415.801 166.117 415.989 167.133 415.802 168.114Z" fill="currentColor"/><path d="M450.243 271.791L325.874 537.744C325.279 539.017 324.06 539.884 322.663 540.028L310.222 541.317C307.126 541.638 304.866 538.456 306.188 535.639L438.448 253.869C439.998 250.567 444.797 250.892 445.887 254.373L450.436 268.901C450.735 269.855 450.666 270.886 450.243 271.791Z" fill="currentColor"/><path d="M366.802 54.653L276.384 578.299C276.222 579.236 275.732 580.085 275.001 580.693L262.243 591.307C259.383 593.686 255.108 591.214 255.744 587.548L352.021 32.6288C352.731 28.5346 358.44 28.1042 359.756 32.0457L366.654 52.7055C366.863 53.3325 366.914 54.0016 366.802 54.653Z" fill="currentColor"/><path d="M347.903 270.232L298.629 462.433C298.207 464.08 296.789 465.28 295.095 465.425L283.849 466.386C281.101 466.621 278.946 464.069 279.636 461.399L332.321 257.673C333.163 254.417 337.403 253.591 339.406 256.292L347.241 266.856C347.959 267.824 348.202 269.065 347.903 270.232Z" fill="currentColor"/><path d="M294.801 259.761L254.748 455.702C254.327 457.763 255.574 459.798 257.602 460.358L281.108 466.855C283.346 467.474 285.639 466.063 286.095 463.787L328.603 251.963C329.216 248.907 326.252 246.355 323.321 247.415L297.36 256.801C296.049 257.274 295.08 258.396 294.801 259.761Z" fill="currentColor" opacity="0.5"/></svg>`;

export default class ContextGeneratorPlugin extends Plugin {
    settings: ContextGeneratorSettings = DEFAULT_SETTINGS;
    private contextBuilder!: ContextBuilder;

    async onload() {
        await this.loadSettings();

        addIcon(ICON_ID, PLUGIN_ICON);

        this.contextBuilder = new ContextBuilder(this.app, this.settings);
        new NoteCreator(this.app).register(this);

        this.addRibbonIcon(ICON_ID, "Générer le contexte projet", () => {
            this.contextBuilder.generate();
        });

        this.registerEvent(
            this.app.workspace.on(
                "file-menu",
                createVSCodeMenuHandler(this.app, this.settings, ICON_ID)
            )
        );

        this.addCommand({
            id: "generate-context",
            name: "Générer le contexte projet",
            callback: () => this.contextBuilder.generate(),
        });

        this.addCommand({
            id: "sync",
            name: "Synchroniser (notes + canvas)",
            callback: () => new ContextImporter(this.app, this.settings).importFromContext(),
        });

        this.addSettingTab(new ContextGeneratorSettingTab(this.app, this));
    }

    getCanvasFiles(): TFile[] {
        return this.app.vault.getFiles().filter((f) => f.extension === "canvas");
    }

    async generateContext(): Promise<void> {
        await this.contextBuilder.generate();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
