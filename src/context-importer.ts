import { App, Notice, TFile } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type { AnyKind, ContextGeneratorSettings } from "./types";
import { CanvasUpdater } from "./canvas-updater";
import { buildTemplate } from "./note-creator";

// --- Section parser ---

interface ParsedSection {
    title:     string;
    vaultPath: string;
    frozen:    boolean;
    kind:      AnyKind | undefined;
    prose:     string;
}

// Matches: ### Title <!-- vault:path [key:value ...] -->
const SECTION_HEADER = /^### (.+?) <!-- vault:([^\s>]+)((?:\s+[\w-]+:[^\s>]+)*)\s*-->/;

function parseHeaderAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const m of attrStr.matchAll(/([\w-]+):([^\s>]+)/g)) {
        attrs[m[1]] = m[2];
    }
    return attrs;
}

function parseSections(content: string): ParsedSection[] {
    const sections: ParsedSection[] = [];
    const lines = content.replace(/\r\n/g, "\n").split("\n");

    let current: {
        title: string; vaultPath: string; frozen: boolean;
        kind: AnyKind | undefined; lines: string[];
    } | null = null;

    for (const line of lines) {
        const m = line.match(SECTION_HEADER);
        if (m) {
            if (current) sections.push(finalizeSection(current));
            const attrs = parseHeaderAttrs(m[3] ?? "");
            current = {
                title:     m[1].trim(),
                vaultPath: m[2],
                frozen:    attrs["frozen"] === "true",
                kind:      attrs["kind"] as AnyKind | undefined,
                lines:     [],
            };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) sections.push(finalizeSection(current));
    return sections;
}

function finalizeSection(raw: {
    title: string; vaultPath: string; frozen: boolean;
    kind: AnyKind | undefined; lines: string[];
}): ParsedSection {
    return {
        title:     raw.title,
        vaultPath: raw.vaultPath,
        frozen:    raw.frozen,
        kind:      raw.kind,
        prose:     extractProse(raw.lines),
    };
}

function extractProse(lines: string[]): string {
    const result: string[] = [];
    let inKindBlock = false;
    let leadingBlank = true;

    for (const line of lines) {
        if (line.trim() === "<!-- kind-block -->")  { inKindBlock = true;  continue; }
        if (line.trim() === "<!-- /kind-block -->") { inKindBlock = false; continue; }
        if (inKindBlock) continue;
        if (line.startsWith("**Source :**") || line.startsWith("**Relations :**")) continue;

        if (line.trim() === "") {
            if (leadingBlank) continue;
            if (result.length > 0 && result[result.length - 1] !== "") result.push("");
        } else {
            leadingBlank = false;
            result.push(line);
        }
    }
    while (result.length > 0 && result[result.length - 1] === "") result.pop();
    return result.join("\n");
}

// --- Lock block merge ---

function extractLockBlocks(text: string): string[] {
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    const re = /:::lock\n[\s\S]*?\n:::/g;
    while ((match = re.exec(text)) !== null) blocks.push(match[0]);
    return blocks;
}

function applyVaultLocks(aiProse: string, vaultLocks: string[]): string {
    if (vaultLocks.length === 0) return aiProse;
    let i = 0;
    return aiProse.replace(/:::lock\n[\s\S]*?\n:::/g, () => vaultLocks[i++] ?? "");
}

function mergeNoteContent(vaultContent: string, aiProse: string): string {
    const fmMatch = vaultContent.match(/^(---\n[\s\S]*?\n---\n)/);
    const frontmatter = fmMatch ? fmMatch[1] : "";
    const afterFm = vaultContent.slice(frontmatter.length);
    const titleMatch = afterFm.match(/^(#{1,6} .+\n)/);
    const titleLine = titleMatch ? titleMatch[1] : "";
    const vaultBody = afterFm.slice(titleLine.length);
    const vaultLocks = extractLockBlocks(vaultBody);
    const merged = applyVaultLocks(aiProse, vaultLocks);
    return `${frontmatter}${titleLine}\n${merged}\n`;
}

// --- ContextImporter ---

export class ContextImporter {
    constructor(
        private readonly app: App,
        private readonly settings: ContextGeneratorSettings,
    ) {}

    async importFromContext(): Promise<void> {
        const projectPath = this.resolveProjectPath();
        if (!projectPath) return;

        const krystalDir = path.join(projectPath, ".krystal");
        const planDir    = path.join(krystalDir, "plan");
        const codeDir    = path.join(krystalDir, "code");

        const specFiles = this.collectSpecFiles(planDir, codeDir);

        if (specFiles.length === 0) {
            await this.importFromContextMd(projectPath);
        } else {
            await this.importFromSpecFiles(specFiles);
        }

        // Always sync canvas from Mermaid in CONTEXT.md
        await new CanvasUpdater(this.app, this.settings).syncFromMermaid();
    }

    private resolveProjectPath(): string | null {
        const { projectPath } = this.settings;
        if (!projectPath) {
            new Notice("⚠️ Chemin projet non configuré dans les settings.");
            return null;
        }
        const vaultPath = (() => {
            const { adapter } = this.app.vault;
            return "getBasePath" in adapter ? (adapter as { getBasePath(): string }).getBasePath() : "";
        })();
        return path.resolve(vaultPath, projectPath);
    }

    private collectSpecFiles(planDir: string, codeDir: string): string[] {
        const files: string[] = [];
        for (const dir of [planDir, codeDir]) {
            try {
                for (const f of fs.readdirSync(dir)) {
                    if (f.endsWith(".md")) files.push(path.join(dir, f));
                }
            } catch {
                // directory doesn't exist yet
            }
        }
        return files;
    }

    private async importFromSpecFiles(specFiles: string[]): Promise<void> {
        let updated = 0, created = 0, skipped = 0;

        for (const filePath of specFiles) {
            let content: string;
            try { content = fs.readFileSync(filePath, "utf8"); }
            catch { skipped++; continue; }

            for (const section of parseSections(content)) {
                const result = await this.applySection(section);
                if (result === "updated") updated++;
                else if (result === "created") created++;
                else skipped++;
            }
        }

        const total = updated + created + skipped;
        if (total === 0) {
            new Notice("⚠️ Aucune section vault trouvée dans .krystal/");
            return;
        }
        const parts = [
            updated > 0 ? `${updated} mise${updated > 1 ? "s" : ""} à jour` : "",
            created > 0 ? `${created} créée${created > 1 ? "s" : ""}` : "",
            skipped > 0 ? `${skipped} ignorée${skipped > 1 ? "s" : ""}` : "",
        ].filter(Boolean);
        new Notice(`✅ Notes synchronisées — ${parts.join(", ")}`);
    }

    private async importFromContextMd(projectPath: string): Promise<void> {
        const contextPath = path.join(projectPath, this.settings.outputFile);
        let contextContent: string;
        try {
            contextContent = fs.readFileSync(contextPath, "utf8");
        } catch {
            new Notice(`⚠️ CONTEXT.md introuvable : ${contextPath}`);
            return;
        }

        const sections = parseSections(contextContent);
        if (sections.length === 0) {
            new Notice("⚠️ Aucune section avec ancre vault trouvée dans le CONTEXT.md.");
            return;
        }

        let updated = 0, created = 0, skipped = 0;
        for (const section of sections) {
            const result = await this.applySection(section);
            if (result === "updated") updated++;
            else if (result === "created") created++;
            else skipped++;
        }

        const parts = [
            updated > 0 ? `${updated} mise${updated > 1 ? "s" : ""} à jour` : "",
            created > 0 ? `${created} créée${created > 1 ? "s" : ""}` : "",
            skipped > 0 ? `${skipped} ignorée${skipped > 1 ? "s" : ""}` : "",
        ].filter(Boolean);
        new Notice(`✅ Synchronisation terminée — ${parts.join(", ")}`);
    }

    private async applySection(section: ParsedSection): Promise<"updated" | "skipped" | "created"> {
        if (section.frozen) return "skipped";
        if (!section.prose.trim()) return "skipped";

        const abstract = this.app.vault.getAbstractFileByPath(section.vaultPath);

        if (!(abstract instanceof TFile)) {
            const folderPath = section.vaultPath.includes("/")
                ? section.vaultPath.slice(0, section.vaultPath.lastIndexOf("/"))
                : null;
            try {
                if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
                    await this.app.vault.createFolder(folderPath);
                }
                const initialContent = section.kind
                    ? buildTemplate(section.kind, section.title)
                    : `## ${section.title}\n\n${section.prose}\n`;
                await this.app.vault.create(section.vaultPath, initialContent);
                return "created";
            } catch {
                return "skipped";
            }
        }

        const vaultContent = await this.app.vault.read(abstract);
        const newContent   = mergeNoteContent(vaultContent, section.prose);
        if (newContent === vaultContent) return "skipped";
        await this.app.vault.modify(abstract, newContent);
        return "updated";
    }
}
