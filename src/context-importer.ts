import { App, Notice, TFile } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type { ContextGeneratorSettings } from "./types";

// --- Section parser ---

interface ParsedSection {
    title:     string;
    vaultPath: string;  // vault-relative path of the source note
    frozen:    boolean;
    prose:     string;  // editable body (Source/Relations/kind-block stripped)
}

const SECTION_HEADER = /^### (.+?) <!-- vault:([^> ]+)(?: frozen:true)? -->/;
const LOCK_BLOCK     = /:::lock\n([\s\S]*?)\n:::/g;

function parseSections(content: string): ParsedSection[] {
    const sections: ParsedSection[] = [];
    const lines = content.split("\n");

    let current: { title: string; vaultPath: string; frozen: boolean; lines: string[] } | null = null;

    for (const line of lines) {
        const m = line.match(SECTION_HEADER);
        if (m) {
            if (current) sections.push(finalizeSection(current));
            current = {
                title:     m[1].trim(),
                vaultPath: m[2],
                frozen:    line.includes("frozen:true"),
                lines:     [],
            };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) sections.push(finalizeSection(current));
    return sections;
}

function finalizeSection(raw: { title: string; vaultPath: string; frozen: boolean; lines: string[] }): ParsedSection {
    return {
        title:     raw.title,
        vaultPath: raw.vaultPath,
        frozen:    raw.frozen,
        prose:     extractProse(raw.lines),
    };
}

// Strip metadata lines (Source, Relations) and kind blocks, normalize whitespace
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
    // trim trailing blank
    while (result.length > 0 && result[result.length - 1] === "") result.pop();
    return result.join("\n");
}

// --- Lock block merge ---

// Extracts all :::lock ... ::: blocks from a string (preserving order)
function extractLockBlocks(text: string): string[] {
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    const re = /:::lock\n[\s\S]*?\n:::/g;
    while ((match = re.exec(text)) !== null) blocks.push(match[0]);
    return blocks;
}

// Applies vault's lock blocks onto the AI-written prose.
// If the AI kept/modified a lock block position → replace with vault version.
// If the AI removed a lock block → it's lost (intentional: AI can clean up if instructed).
function applyVaultLocks(aiProse: string, vaultLocks: string[]): string {
    if (vaultLocks.length === 0) return aiProse;
    let i = 0;
    return aiProse.replace(/:::lock\n[\s\S]*?\n:::/g, () => vaultLocks[i++] ?? "");
}

// --- Note content merge ---

// Rebuilds a vault note's content:
// - frontmatter stays untouched
// - title heading stays untouched
// - body is replaced with AI prose, with vault's lock blocks restored
function mergeNoteContent(vaultContent: string, aIProse: string): string {
    // Isolate frontmatter
    const fmMatch = vaultContent.match(/^(---\n[\s\S]*?\n---\n)/);
    const frontmatter = fmMatch ? fmMatch[1] : "";

    const afterFm = vaultContent.slice(frontmatter.length);

    // Isolate title heading (first # line)
    const titleMatch = afterFm.match(/^(#{1,6} .+\n)/);
    const titleLine = titleMatch ? titleMatch[1] : "";

    const vaultBody = afterFm.slice(titleLine.length);
    const vaultLocks = extractLockBlocks(vaultBody);

    const merged = applyVaultLocks(aIProse, vaultLocks);
    return `${frontmatter}${titleLine}\n${merged}\n`;
}

// --- ContextImporter ---

export class ContextImporter {
    constructor(
        private readonly app: App,
        private readonly settings: ContextGeneratorSettings,
    ) {}

    async importFromContext(): Promise<void> {
        const contextPath = this.resolveContextPath();
        if (!contextPath) return;

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

        new Notice(`⏳ Synchronisation de ${sections.length} section${sections.length > 1 ? "s" : ""}…`);

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

    private resolveContextPath(): string | null {
        const { projectPath, outputFile } = this.settings;
        if (!projectPath) {
            new Notice("⚠️ Chemin projet non configuré dans les settings.");
            return null;
        }
        const vaultPath = (() => {
            const { adapter } = this.app.vault;
            return "getBasePath" in adapter ? (adapter as { getBasePath(): string }).getBasePath() : "";
        })();
        return path.join(path.resolve(vaultPath, projectPath), outputFile);
    }

    private async applySection(section: ParsedSection): Promise<"updated" | "skipped" | "created"> {
        if (section.frozen) return "skipped";
        if (!section.prose.trim()) return "skipped";

        const abstract = this.app.vault.getAbstractFileByPath(section.vaultPath);

        if (!(abstract instanceof TFile)) {
            // Note inconnue → la créer
            const folderPath = section.vaultPath.includes("/")
                ? section.vaultPath.slice(0, section.vaultPath.lastIndexOf("/"))
                : null;
            try {
                if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
                    await this.app.vault.createFolder(folderPath);
                }
                await this.app.vault.create(
                    section.vaultPath,
                    `## ${section.title}\n\n${section.prose}\n`,
                );
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
