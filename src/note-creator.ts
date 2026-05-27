import { App, EventRef, Modal, Notice, Setting, TAbstractFile, TFile } from "obsidian";
import type { AnyKind, CodeKind, PlanKind } from "./types";

// --- Constants ---

const CODE_KINDS: CodeKind[] = ["component", "interface", "type", "enum", "config", "media", "file"];
const PLAN_KINDS: PlanKind[] = ["epic", "task", "milestone", "decision", "question", "spec"];
const ALL_KINDS:  AnyKind[]  = [...PLAN_KINDS, ...CODE_KINDS];

export const KIND_LABELS: Record<AnyKind, string> = {
    // Plan
    epic:      "Épique",
    task:      "Tâche",
    milestone: "Jalon",
    decision:  "Décision",
    question:  "Question",
    spec:      "Spécification",
    // Code
    component: "Composant",
    interface: "Interface",
    type:      "Type",
    enum:      "Énumération",
    config:    "Configuration",
    media:     "Média",
    file:      "Fichier",
};

const KIND_DESCRIPTIONS: Record<AnyKind, string> = {
    // Plan
    epic:      "Objectif de haut niveau avec critères d'acceptance",
    task:      "Tâche actionnable avec statut et responsable",
    milestone: "Livrable ou point de contrôle daté",
    decision:  "Décision architecturale avec contexte et options",
    question:  "Question ouverte à résoudre",
    spec:      "Spécification technique détaillée",
    // Code
    component: "Module, classe ou système autonome",
    interface: "Structure de données ou contrat",
    type:      "Alias de type ou union",
    enum:      "Ensemble de valeurs nommées",
    config:    "Paramètres exposés ou options de configuration",
    media:     "Asset média (image, vidéo, audio, shader…)",
    file:      "Référence de fichier générique",
};

// --- Templates ---

function buildTemplate(kind: AnyKind, name: string): string {
    switch (kind) {
        // Plan kinds
        case "epic":
            return (
                `---\nkind: epic\nstatus: open\npriority: medium\n---\n\n` +
                `## ${name}\n\n### Objectif\n\nDécris l'objectif ici.\n\n` +
                `### Critères d'acceptance\n\n- [ ] Critère 1\n- [ ] Critère 2\n`
            );
        case "task":
            return (
                `---\nkind: task\nstatus: todo\nassignee: ""\n---\n\n` +
                `## ${name}\n\nDescription de la tâche.\n\n` +
                `### Checklist\n\n- [ ] Étape 1\n- [ ] Étape 2\n`
            );
        case "milestone":
            return (
                `---\nkind: milestone\ndate: ""\n---\n\n` +
                `## ${name}\n\nLivrable attendu à cette date.\n`
            );
        case "decision":
            return (
                `---\nkind: decision\nstatus: open\noptions:\n  - Option A\n  - Option B\n---\n\n` +
                `## ${name}\n\n### Contexte\n\nPourquoi cette décision est nécessaire.\n\n` +
                `### Décision retenue\n\n_En attente._\n`
            );
        case "question":
            return (
                `---\nkind: question\nstatus: open\n---\n\n` +
                `## ${name}\n\nFormulation de la question.\n\n### Éléments de réponse\n\n_En cours._\n`
            );
        case "spec":
            return (
                `---\nkind: spec\n---\n\n` +
                `## ${name}\n\nSpécification technique détaillée.\n`
            );
        // Code kinds
        case "interface": {
            const h = `---\nkind: interface\nfile: src/\nfields:\n  - name: field1\n    type: string\n    desc: Description du champ\n---\n\n`;
            return `${h}## ${name}\n\nDescription de l'interface.\n`;
        }
        case "type": {
            const h = `---\nkind: type\nfile: src/\ndefinition: "${name} = ..."\n---\n\n`;
            return `${h}## ${name}\n\nDescription du type.\n`;
        }
        case "enum": {
            const h = `---\nkind: enum\nfile: src/\nvalues:\n  - name: VALUE_A\n    desc: Première valeur\n  - name: VALUE_B\n    desc: Deuxième valeur\n---\n\n`;
            return `${h}## ${name}\n\nDescription de l'énumération.\n`;
        }
        case "config": {
            const h = `---\nkind: config\nfile: src/\nparams:\n  - name: param1\n    type: string\n    default: ""\n    desc: Description du paramètre\n---\n\n`;
            return `${h}## ${name}\n\nConfiguration de...\n`;
        }
        case "media":
            return `---\nkind: media\nfile: assets/\nformat: png\n---\n\n## ${name}\n\nDescription du média.\n`;
        case "component":
            return `---\nkind: component\nfile: src/\n---\n\n## ${name}\n\nDescription du composant.\n`;
        case "file":
        default:
            return `---\nkind: file\nfile: src/\n---\n\n## ${name}\n\nDescription.\n`;
    }
}

// --- Plugin interface (avoids circular dep with main.ts) ---

interface IPlugin {
    app: App;
    addCommand(cmd: { id: string; name: string; callback: () => void }): void;
    registerEvent(ref: EventRef): void;
}

// --- NoteCreator ---

export class NoteCreator {
    constructor(private readonly app: App) {}

    register(plugin: IPlugin): void {
        for (const kind of ALL_KINDS) {
            plugin.addCommand({
                id:       `create-note-${kind}`,
                name:     `Nouvelle fiche · ${KIND_LABELS[kind]}`,
                callback: () => new CreateNoteModal(this.app, kind, (name, folder) =>
                    this.createNote(kind, name, folder)
                ).open(),
            });
        }

        plugin.registerEvent(
            plugin.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
                if (!(file instanceof TFile) || file.extension !== "md") return;
                menu.addItem(item =>
                    item
                        .setTitle("Krystal : Définir le kind")
                        .setIcon("tag")
                        .onClick(() => new SetKindModal(this.app, kind =>
                            this.setKind(file, kind)
                        ).open())
                );
            })
        );
    }

    private async createNote(kind: AnyKind, name: string, folder: string): Promise<void> {
        const prefix   = folder ? (folder.endsWith("/") ? folder : `${folder}/`) : "";
        const notePath = `${prefix}${name}.md`;

        try {
            if (prefix) {
                const folderPath = prefix.slice(0, -1);
                if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                    await this.app.vault.createFolder(folderPath);
                }
            }
            const file = await this.app.vault.create(notePath, buildTemplate(kind, name));
            await this.app.workspace.getLeaf().openFile(file);
            new Notice(`✅ Fiche ${KIND_LABELS[kind]} créée : ${notePath}`);
        } catch (e: unknown) {
            new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async setKind(file: TFile, kind: AnyKind): Promise<void> {
        const content = await this.app.vault.read(file);
        let updated: string;

        if (content.startsWith("---\n")) {
            const end = content.indexOf("\n---\n", 4);
            if (end !== -1) {
                const fm    = content.slice(4, end);
                const newFm = /^kind:/m.test(fm)
                    ? fm.replace(/^kind:.*$/m, `kind: ${kind}`)
                    : `kind: ${kind}\n${fm}`;
                updated = `---\n${newFm}\n---\n${content.slice(end + 5)}`;
            } else {
                updated = `---\nkind: ${kind}\n---\n\n${content}`;
            }
        } else {
            updated = `---\nkind: ${kind}\n---\n\n${content}`;
        }

        await this.app.vault.modify(file, updated);
        new Notice(`✅ Kind défini : ${KIND_LABELS[kind]}`);
    }
}

// --- Modals ---

class CreateNoteModal extends Modal {
    private name   = "";
    private folder = "";

    constructor(
        app: App,
        private readonly kind: AnyKind,
        private readonly onSubmit: (name: string, folder: string) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: `Nouvelle fiche · ${KIND_LABELS[this.kind]}` });
        contentEl.createEl("p", {
            text: KIND_DESCRIPTIONS[this.kind],
            cls:  "setting-item-description",
        });

        new Setting(contentEl)
            .setName("Nom")
            .addText(text => {
                text.setPlaceholder("MonComposant").onChange(v => (this.name = v.trim()));
                setTimeout(() => text.inputEl.focus(), 50);
                text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                    if (e.key === "Enter") this.submit();
                });
            });

        new Setting(contentEl)
            .setName("Dossier dans le vault")
            .setDesc("Laisser vide pour la racine du vault")
            .addText(text =>
                text.setPlaceholder("Notes/").onChange(v => (this.folder = v.trim()))
            );

        new Setting(contentEl).addButton(btn =>
            btn.setButtonText("Créer").setCta().onClick(() => this.submit())
        );
    }

    private submit(): void {
        if (!this.name) { new Notice("⚠️ Le nom est requis."); return; }
        this.close();
        this.onSubmit(this.name, this.folder);
    }

    onClose(): void { this.contentEl.empty(); }
}

class SetKindModal extends Modal {
    constructor(app: App, private readonly onSubmit: (kind: AnyKind) => void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Définir le kind" });

        contentEl.createEl("h3", { text: "Plan", cls: "setting-item-name" });
        for (const kind of PLAN_KINDS) {
            new Setting(contentEl)
                .setName(KIND_LABELS[kind])
                .setDesc(KIND_DESCRIPTIONS[kind])
                .addButton(btn =>
                    btn.setButtonText("Sélectionner").onClick(() => { this.close(); this.onSubmit(kind); })
                );
        }

        contentEl.createEl("h3", { text: "Code", cls: "setting-item-name" });
        for (const kind of CODE_KINDS) {
            new Setting(contentEl)
                .setName(KIND_LABELS[kind])
                .setDesc(KIND_DESCRIPTIONS[kind])
                .addButton(btn =>
                    btn.setButtonText("Sélectionner").onClick(() => { this.close(); this.onSubmit(kind); })
                );
        }
    }

    onClose(): void { this.contentEl.empty(); }
}
