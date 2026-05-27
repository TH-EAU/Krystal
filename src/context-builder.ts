import { App, FileSystemAdapter, FileView, Notice, TFile } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type { AnyKind, CanvasData, CanvasNode, CanvasEdge, ContextGeneratorSettings, NoteFrontmatter } from "./types";
import { kindCategory } from "./types";
import { KRYSTAL_API_CONTENT } from "./krystal-api";

// --- Frontmatter (used by vscode-menu.ts) ---

export function parseFrontmatter(content: string): NoteFrontmatter {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: NoteFrontmatter = {};
    for (const line of match[1].split("\n")) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        if (key === "file"   && val)            result.file   = val;
        if (key === "kind"   && val)            result.kind   = val as AnyKind;
        if (key === "frozen" && val === "true") result.frozen = true;
    }
    return result;
}

// Strips frontmatter and mermaid blocks, collapses blank lines
function normalizeContent(content: string): string {
    const body = content
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/```mermaid[\s\S]*?```/g, "")
        .trimLeft();
    const lines = body.split("\n");
    const out: string[] = [];
    for (const line of lines) {
        if (line.trim() === "") {
            if (out.length > 0 && out[out.length - 1] !== "") out.push("");
        } else {
            out.push(line);
        }
    }
    return out.join("\n").trimEnd();
}

// --- Utilities ---

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*\n\r]/g, "-").replace(/\s+/g, " ").trim() || "groupe";
}

function relPath(from: string, to: string): string {
    return path.relative(path.dirname(from), to).replace(/\\/g, "/");
}

// --- Canvas geometry ---

function isContained(inner: CanvasNode, outer: CanvasNode): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width  <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function directParentGroup(node: CanvasNode, groups: CanvasNode[]): CanvasNode | null {
    const containers = groups.filter(g => g.id !== node.id && isContained(node, g));
    if (containers.length === 0) return null;
    return containers.reduce((a, b) =>
        a.width * a.height <= b.width * b.height ? a : b
    );
}

// --- Group tree ---

interface GroupTree {
    group: CanvasNode;
    nodes:    CanvasNode[];
    children: GroupTree[];
}

function buildGroupTree(canvas: CanvasData): { topLevelGroups: GroupTree[]; topLevelNodes: CanvasNode[] } {
    const groups    = canvas.nodes.filter(n => n.type === "group");
    const nonGroups = canvas.nodes.filter(n => n.type !== "group");

    const treeMap = new Map<string, GroupTree>();
    for (const g of groups) treeMap.set(g.id, { group: g, nodes: [], children: [] });

    const topLevelGroups: GroupTree[] = [];
    for (const g of groups) {
        const parent = directParentGroup(g, groups);
        if (parent) treeMap.get(parent.id)!.children.push(treeMap.get(g.id)!);
        else        topLevelGroups.push(treeMap.get(g.id)!);
    }

    const topLevelNodes: CanvasNode[] = [];
    for (const node of nonGroups) {
        const parent = directParentGroup(node, groups);
        if (parent) treeMap.get(parent.id)!.nodes.push(node);
        else        topLevelNodes.push(node);
    }
    return { topLevelGroups, topLevelNodes };
}

// Collect all .md file nodes recursively (flat, excluding .canvas refs)
function collectAllMdNodes(nodes: CanvasNode[], groups: GroupTree[]): (CanvasNode & { type: "file"; file: string })[] {
    const result: (CanvasNode & { type: "file"; file: string })[] = [];
    for (const n of nodes) {
        if (n.type === "file" && n.file && !n.file.endsWith(".canvas")) {
            result.push(n as CanvasNode & { type: "file"; file: string });
        }
    }
    for (const g of groups) result.push(...collectAllMdNodes(g.nodes, g.children));
    return result;
}

// --- Mermaid ---

function mermaidEscape(text: string, maxLen = 40): string {
    const clean = text.replace(/\r?\n/g, " ").replace(/"/g, "'").replace(/[<>{}[\]]/g, " ").trim();
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

function mermaidShape(label: string, kind: AnyKind | undefined, isCanvas: boolean): string {
    if (isCanvas) return `[["${label}"]]`;
    switch (kind) {
        case "interface": return `{{"${label}"}}`;
        case "type":      return `[/"${label}"/]`;
        case "enum":      return `{"${label}"}`;
        case "config":    return `[("${label}")]`;
        case "media":     return `[/"${label}"\\]`;
        case "epic":      return `(("${label}"))`;
        case "milestone": return `([" ${label} "])`;
        case "decision":  return `{" ${label} "}`;
        case "question":  return `[" ${label} ?"]`;
        case "spec":      return `[/"${label}"/]`;
        default:          return `["${label}"]`;
    }
}

function mermaidNodeDef(node: CanvasNode, kind?: AnyKind): string {
    const id        = node.id;
    const kindClass = kind ? `:::${kind}` : "";
    switch (node.type) {
        case "file": {
            const label = mermaidEscape(path.basename(node.file ?? "", path.extname(node.file ?? "")));
            return id + mermaidShape(label, kind, !!node.file?.endsWith(".canvas")) + kindClass;
        }
        case "text":
            return `${id}("${mermaidEscape(node.text ?? "")}")`;
        case "link":
            return `${id}["🔗 ${mermaidEscape(node.label ?? node.url ?? "")}"]`;
        default:
            return `${id}["?"]`;
    }
}

function collectDiagramIds(nodes: CanvasNode[], groups: GroupTree[]): Set<string> {
    const ids = new Set<string>();
    for (const n of nodes) ids.add(n.id);
    for (const g of groups) {
        ids.add(g.group.id);
        for (const id of collectDiagramIds(g.nodes, g.children)) ids.add(id);
    }
    return ids;
}

function renderGroupLines(tree: GroupTree, nodeKinds: Map<string, AnyKind>, indent: string): string[] {
    const next  = indent + "    ";
    const label = mermaidEscape(tree.group.label ?? "groupe", 50);
    const lines = [
        `${indent}subgraph G_${tree.group.id}["${label}"]`,
        `${next}${tree.group.id}:::gw`,
    ];
    for (const child of tree.children) lines.push(...renderGroupLines(child, nodeKinds, next));
    for (const node of tree.nodes)     lines.push(`${next}${mermaidNodeDef(node, nodeKinds.get(node.id))}`);
    lines.push(`${indent}end`);
    return lines;
}

function buildMermaidDiagram(
    nodes:     CanvasNode[],
    groups:    GroupTree[],
    edges:     CanvasEdge[],
    nodeKinds: Map<string, AnyKind>,
): string {
    const lines = [
        "```mermaid",
        "flowchart TD",
        "    classDef gw        fill:none,stroke:none,color:transparent,width:0px",
        "    classDef epic      fill:#7c3aed,color:#fff,stroke:#6d28d9",
        "    classDef task      fill:#8b5cf6,color:#fff,stroke:#7c3aed",
        "    classDef milestone fill:#6d28d9,color:#fff,stroke:#5b21b6",
        "    classDef decision  fill:#5b21b6,color:#fff,stroke:#4c1d95",
        "    classDef question  fill:#4c1d95,color:#fff,stroke:#3b0764",
        "    classDef spec      fill:#7c3aed,color:#fff,stroke:#5b21b6,stroke-dasharray:4",
        "    classDef component fill:#1d4ed8,color:#fff,stroke:#1e40af",
        "    classDef interface fill:#1e40af,color:#fff,stroke:#1d4ed8",
        "    classDef type      fill:#1e3a8a,color:#fff,stroke:#1e40af",
        "    classDef enum      fill:#1d4ed8,color:#fff,stroke:#1e3a8a,stroke-dasharray:4",
        "    classDef config    fill:#0369a1,color:#fff,stroke:#0284c7",
        "    classDef media     fill:#0369a1,color:#fff,stroke:#0369a1,stroke-dasharray:4",
    ];
    for (const g of groups) lines.push(...renderGroupLines(g, nodeKinds, "    "));
    for (const n of nodes)  lines.push(`    ${mermaidNodeDef(n, nodeKinds.get(n.id))}`);

    const validIds = collectDiagramIds(nodes, groups);
    for (const e of edges) {
        if (!validIds.has(e.fromNode) || !validIds.has(e.toNode)) continue;
        const lbl = e.label ? ` |"${mermaidEscape(e.label)}"|` : "";
        lines.push(`    ${e.fromNode} -->${lbl} ${e.toNode}`);
    }
    lines.push("```");
    return lines.join("\n");
}

// --- ContextBuilder ---

export class ContextBuilder {
    constructor(
        private readonly app: App,
        private readonly settings: ContextGeneratorSettings,
    ) {}

    private getVaultPath(): string {
        const { adapter } = this.app.vault;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    }

    private getActiveCanvasFile(): TFile | null {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return null;
        const view = leaf.view;
        if (view.getViewType() !== "canvas") return null;
        const file = (view as FileView).file;
        return file instanceof TFile ? file : null;
    }

    async generate(): Promise<void> {
        const canvasTFile = this.getActiveCanvasFile() ?? this.resolveSettingsCanvas();
        if (!canvasTFile) return;

        new Notice("⏳ Génération du contexte...");
        try {
            const projectPath = path.resolve(this.getVaultPath(), this.settings.projectPath);
            const mainPath    = path.join(projectPath, this.settings.outputFile);
            const krystalDir  = path.join(projectPath, ".krystal");
            const planDir     = path.join(krystalDir, "plan");
            const codeDir     = path.join(krystalDir, "code");

            fs.mkdirSync(planDir, { recursive: true });
            fs.mkdirSync(codeDir, { recursive: true });
            fs.writeFileSync(path.join(krystalDir, "KRYSTAL_API.md"), KRYSTAL_API_CONTENT, "utf8");

            const noteCount = await this.processCanvas(
                canvasTFile, mainPath, planDir, codeDir, krystalDir, projectPath,
            );

            new Notice(
                `✅ ${canvasTFile.basename} → ${this.settings.outputFile}` +
                (noteCount > 0 ? ` · ${noteCount} note${noteCount > 1 ? "s" : ""}` : ""),
            );
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(e);
            new Notice(`❌ Erreur : ${msg}`);
        }
    }

    private resolveSettingsCanvas(): TFile | null {
        const { canvasFile } = this.settings;
        if (!canvasFile) { new Notice("⚠️ Aucun canvas ouvert ni configuré dans les settings."); return null; }
        const f = this.app.vault.getAbstractFileByPath(canvasFile);
        if (!(f instanceof TFile)) { new Notice(`⚠️ Canvas introuvable : ${canvasFile}`); return null; }
        return f;
    }

    private async processCanvas(
        canvasTFile: TFile,
        contextPath: string,
        planDir:     string,
        codeDir:     string,
        krystalDir:  string,
        projectPath: string,
    ): Promise<number> {
        const raw    = await this.app.vault.read(canvasTFile);
        const canvas: CanvasData = JSON.parse(raw);
        const { topLevelGroups, topLevelNodes } = buildGroupTree(canvas);

        // Collect kinds for all nodes (including nested groups)
        const allMdNodes = collectAllMdNodes(topLevelNodes, topLevelGroups);
        const nodeKinds  = this.collectNodeKinds(allMdNodes);

        // Write individual spec files → .krystal/plan/ or .krystal/code/
        const specLinks: { name: string; kind: AnyKind; file: string; category: "plan" | "code" }[] = [];

        for (const node of allMdNodes) {
            const tfile = this.app.vault.getAbstractFileByPath(node.file);
            if (!(tfile instanceof TFile)) continue;

            const fm            = this.app.metadataCache.getFileCache(tfile)?.frontmatter ?? {};
            const effectiveKind = (fm.kind as AnyKind | undefined) ?? nodeKinds.get(node.id) ?? "component";
            const category      = kindCategory(effectiveKind);
            const targetDir     = category === "plan" ? planDir : codeDir;
            const safeName      = sanitizeFilename(tfile.basename);
            const specPath      = path.join(targetDir, `${safeName}.md`);

            const content = await this.renderNoteFile(node, canvas, effectiveKind, projectPath);
            fs.writeFileSync(specPath, content, "utf8");

            specLinks.push({ name: tfile.basename, kind: effectiveKind, file: specPath, category });
        }

        // Write CONTEXT.md
        const contextContent = this.buildContextIndex(
            canvasTFile.basename,
            topLevelNodes, topLevelGroups,
            canvas.edges, nodeKinds,
            contextPath, krystalDir, specLinks,
        );
        fs.mkdirSync(path.dirname(contextPath), { recursive: true });
        fs.writeFileSync(contextPath, contextContent, "utf8");

        return allMdNodes.length;
    }

    private collectNodeKinds(nodes: (CanvasNode & { type: "file"; file: string })[]): Map<string, AnyKind> {
        const map = new Map<string, AnyKind>();
        for (const node of nodes) {
            const tfile = this.app.vault.getAbstractFileByPath(node.file);
            if (!(tfile instanceof TFile)) continue;
            const fm = this.app.metadataCache.getFileCache(tfile)?.frontmatter;
            if (fm?.kind) map.set(node.id, fm.kind as AnyKind);
        }
        return map;
    }

    private buildContextIndex(
        title:      string,
        nodes:      CanvasNode[],
        groups:     GroupTree[],
        edges:      CanvasEdge[],
        nodeKinds:  Map<string, AnyKind>,
        contextPath: string,
        krystalDir:  string,
        specLinks:   { name: string; kind: AnyKind; file: string; category: "plan" | "code" }[],
    ): string {
        const lines: string[] = [];
        const now = new Date().toLocaleDateString("fr-FR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
        const apiPath = path.join(krystalDir, "KRYSTAL_API.md");

        lines.push(`# ${title}`);
        lines.push(`_Généré le ${now} · [→ Krystal API](${relPath(contextPath, apiPath)}) — comment interagir avec ces fichiers_`);
        lines.push("");

        // Full Mermaid diagram
        lines.push(buildMermaidDiagram(nodes, groups, edges, nodeKinds));
        lines.push("");

        // Text nodes inline
        const textNodes = nodes.filter(
            (n): n is CanvasNode & { type: "text"; text: string } => n.type === "text" && !!n.text,
        );
        if (textNodes.length > 0) {
            lines.push("## Notes");
            lines.push("");
            for (const n of textNodes) { lines.push(n.text.trim()); lines.push(""); }
        }

        // Link nodes
        const linkNodes = nodes.filter(
            (n): n is CanvasNode & { type: "link"; url: string } => n.type === "link" && !!n.url,
        );
        if (linkNodes.length > 0) {
            lines.push("## Liens externes");
            lines.push("");
            for (const n of linkNodes) lines.push(`- [${n.label ?? n.url}](${n.url})`);
            lines.push("");
        }

        // Index table — Plan
        const planLinks = specLinks.filter(s => s.category === "plan");
        if (planLinks.length > 0) {
            lines.push("## Plan");
            lines.push("");
            lines.push("| Note | Kind | Spec |");
            lines.push("|---|---|---|");
            for (const s of planLinks) {
                lines.push(`| **${s.name}** | \`${s.kind}\` | [${relPath(contextPath, s.file)}](${relPath(contextPath, s.file)}) |`);
            }
            lines.push("");
        }

        // Index table — Code
        const codeLinks = specLinks.filter(s => s.category === "code");
        if (codeLinks.length > 0) {
            lines.push("## Code");
            lines.push("");
            lines.push("| Note | Kind | Spec |");
            lines.push("|---|---|---|");
            for (const s of codeLinks) {
                lines.push(`| **${s.name}** | \`${s.kind}\` | [${relPath(contextPath, s.file)}](${relPath(contextPath, s.file)}) |`);
            }
            lines.push("");
        }

        lines.push("---");
        lines.push(`_${specLinks.length} spec${specLinks.length !== 1 ? "s" : ""} · ${planLinks.length} plan · ${codeLinks.length} code_`);

        return lines.join("\n");
    }

    private async renderNoteFile(
        node:        CanvasNode & { file: string },
        canvas:      CanvasData,
        kind:        AnyKind,
        projectPath: string,
    ): Promise<string> {
        const tfile = this.app.vault.getAbstractFileByPath(node.file);

        if (!(tfile instanceof TFile) || tfile.extension !== "md") {
            const name = path.basename(node.file, path.extname(node.file));
            return `### ${name} <!-- vault:${node.file} kind:file -->\n\n_Fichier introuvable : \`${node.file}\`_\n`;
        }

        const raw = await this.app.vault.read(tfile);
        const fm  = this.app.metadataCache.getFileCache(tfile)?.frontmatter ?? {};

        const connections = canvas.edges
            .filter((e: CanvasEdge) => e.fromNode === node.id || e.toNode === node.id)
            .map((e: CanvasEdge) => {
                const otherId = e.fromNode === node.id ? e.toNode : e.fromNode;
                const other   = canvas.nodes.find(n => n.id === otherId);
                const name    = other?.file
                    ? path.basename(other.file, path.extname(other.file))
                    : (other?.label ?? otherId);
                const dir     = e.fromNode === node.id ? "→" : "←";
                const lbl     = e.label ? ` _(${e.label})_` : "";
                return `${dir} **${name}**${lbl}`;
            });

        const isFrozen = fm.frozen === true;
        const isPlan   = kindCategory(kind) === "plan";
        const attrParts = [
            `kind:${kind}`,
            isFrozen ? "frozen:true" : "",
            isPlan   ? "plan:true"   : "",
        ].filter(Boolean).join(" ");

        const lines: string[] = [];
        lines.push(`### ${tfile.basename} <!-- vault:${tfile.path} ${attrParts} -->`);
        if (fm.file) {
            lines.push(`**Source :** [${fm.file}](vscode://file/${path.join(projectPath, fm.file as string)})`);
        }
        if (connections.length > 0) {
            lines.push(`**Relations :** ${connections.join(" · ")}`);
        }
        lines.push("");

        const kindLines = this.renderKindBlock(kind, tfile.basename, fm);
        if (kindLines.length > 0) {
            lines.push("<!-- kind-block -->");
            lines.push(...kindLines);
            lines.push("<!-- /kind-block -->");
        }

        const body = normalizeContent(raw);
        if (body) { lines.push(body); lines.push(""); }

        return lines.join("\n");
    }

    private renderKindBlock(kind: AnyKind, name: string, fm: Record<string, unknown>): string[] {
        const lines: string[] = [];
        switch (kind) {
            case "interface": {
                type Field = { name: string; type: string; desc?: string };
                const fields = fm.fields as Field[] | undefined;
                if (fields?.length) {
                    lines.push("```typescript");
                    lines.push(`interface ${name} {`);
                    for (const f of fields) lines.push(`  ${f.name}: ${f.type};${f.desc ? `  // ${f.desc}` : ""}`);
                    lines.push("}");
                    lines.push("```");
                    lines.push("");
                }
                break;
            }
            case "type": {
                const def = fm.definition as string | undefined;
                if (def) {
                    lines.push("```typescript");
                    lines.push(`type ${name} = ${def}`);
                    lines.push("```");
                    lines.push("");
                }
                break;
            }
            case "enum": {
                type EnumVal = { name: string; desc?: string };
                const values = fm.values as EnumVal[] | undefined;
                if (values?.length) {
                    lines.push("```typescript");
                    lines.push(`enum ${name} {`);
                    for (const v of values) lines.push(`  ${v.name},${v.desc ? `  // ${v.desc}` : ""}`);
                    lines.push("}");
                    lines.push("```");
                    lines.push("");
                }
                break;
            }
            case "config": {
                type Param = { name: string; type?: string; default?: string; desc?: string };
                const params = fm.params as Param[] | undefined;
                if (params?.length) {
                    lines.push("| Paramètre | Type | Défaut | Description |");
                    lines.push("|---|---|---|---|");
                    for (const p of params) {
                        lines.push(`| \`${p.name}\` | \`${p.type ?? "?"}\` | \`${p.default ?? "—"}\` | ${p.desc ?? ""} |`);
                    }
                    lines.push("");
                }
                break;
            }
            case "media": {
                const parts: string[] = [];
                if (fm.format)     parts.push(`Format : \`${fm.format}\``);
                if (fm.dimensions) parts.push(`Dimensions : \`${fm.dimensions}\``);
                if (parts.length)  { lines.push(parts.join(" · ")); lines.push(""); }
                break;
            }
            case "epic": {
                const rows: string[] = [];
                if (fm.status)   rows.push(`**Statut :** ${fm.status}`);
                if (fm.priority) rows.push(`**Priorité :** ${fm.priority}`);
                if (rows.length) { lines.push(rows.join(" · ")); lines.push(""); }
                break;
            }
            case "task": {
                const rows: string[] = [];
                if (fm.status)   rows.push(`**Statut :** ${fm.status}`);
                if (fm.assignee) rows.push(`**Assigné :** ${fm.assignee}`);
                if (rows.length) { lines.push(rows.join(" · ")); lines.push(""); }
                break;
            }
            case "milestone": {
                if (fm.date) { lines.push(`**Date :** ${fm.date}`); lines.push(""); }
                break;
            }
            case "decision": {
                const opts = fm.options as string[] | undefined;
                if (opts?.length) {
                    lines.push("**Options :**");
                    for (const o of opts) lines.push(`- ${o}`);
                    lines.push("");
                }
                if (fm.status) { lines.push(`**Statut :** ${fm.status}`); lines.push(""); }
                break;
            }
            case "question": {
                if (fm.status) { lines.push(`**Statut :** ${fm.status}`); lines.push(""); }
                break;
            }
        }
        return lines;
    }
}
