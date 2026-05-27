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
        if (key === "file"   && val)          result.file   = val;
        if (key === "kind"   && val)          result.kind   = val as AnyKind;
        if (key === "frozen" && val === "true") result.frozen = true;
    }
    return result;
}

// Strips frontmatter and mermaid blocks (already in the overview diagram), collapses blank lines
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
    const groups   = canvas.nodes.filter(n => n.type === "group");
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

// --- Mermaid ---

function mermaidEscape(text: string, maxLen = 40): string {
    const clean = text.replace(/\r?\n/g, " ").replace(/"/g, "'").replace(/[<>{}[\]]/g, " ").trim();
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

// Mermaid node shape per kind
function mermaidShape(label: string, kind: AnyKind | undefined, isCanvas: boolean): string {
    if (isCanvas) return `[["${label}"]]`;
    switch (kind) {
        // CodeKind shapes
        case "interface": return `{{"${label}"}}`;
        case "type":      return `[/"${label}"/]`;
        case "enum":      return `{"${label}"}`;
        case "config":    return `[("${label}")]`;
        case "media":     return `[/"${label}"\\]`;
        // PlanKind shapes (visually distinct from code kinds)
        case "epic":      return `(("${label}"))`;
        case "milestone": return `([" ${label} "])`;
        case "decision":  return `{" ${label} "}`;
        case "question":  return `[" ${label} ?"]`;
        case "spec":      return `[/"${label}"/]`;
        // task, component, file: rectangle
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
        `${next}${tree.group.id}:::gw`,  // invisible gateway pour les edges qui ciblent le groupe
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
            const outputFile  = this.settings.outputFile;
            const outputBase  = outputFile.replace(/\.md$/i, "");
            const mainPath    = path.join(projectPath, outputFile);
            const subDir      = path.join(projectPath, outputBase);

            fs.mkdirSync(projectPath, { recursive: true });
            fs.writeFileSync(path.join(projectPath, "KRYSTAL_API.md"), KRYSTAL_API_CONTENT, "utf8");

            const visited = new Set<string>();
            const count   = await this.processCanvas(canvasTFile, mainPath, subDir, null, projectPath, visited);

            new Notice(
                `✅ ${canvasTFile.basename} → ${outputFile}` +
                (count > 1 ? ` + ${count - 1} sous-contexte${count > 2 ? "s" : ""}` : ""),
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
        outputPath:  string,
        subDir:      string,
        mainPath:    string | null,
        projectPath: string,
        visited:     Set<string>,
    ): Promise<number> {
        if (visited.has(canvasTFile.path)) return 0;
        visited.add(canvasTFile.path);

        const raw    = await this.app.vault.read(canvasTFile);
        const canvas: CanvasData = JSON.parse(raw);
        const { topLevelGroups, topLevelNodes } = buildGroupTree(canvas);

        const nodeKinds = this.collectNodeKinds(topLevelNodes, topLevelGroups);
        const content   = await this.buildMarkdown(
            canvasTFile.basename, topLevelNodes, topLevelGroups,
            canvas, nodeKinds, projectPath, outputPath, subDir, mainPath,
        );
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, content, "utf8");

        let count = 1;
        count += await this.writeGroupSubContexts(topLevelGroups, canvas, projectPath, outputPath, subDir, visited);

        // Canvas file references au top-level → sous-contextes récursifs
        for (const node of topLevelNodes) {
            if (node.type !== "file" || !node.file?.endsWith(".canvas")) continue;
            const ref = this.app.vault.getAbstractFileByPath(node.file);
            if (!(ref instanceof TFile)) continue;
            const safeName = sanitizeFilename(ref.basename);
            count += await this.processCanvas(
                ref,
                path.join(subDir, `${safeName}.md`),
                path.join(subDir, safeName),
                outputPath, projectPath, visited,
            );
        }
        return count;
    }

    private async writeGroupSubContexts(
        groups:      GroupTree[],
        canvas:      CanvasData,
        projectPath: string,
        parentPath:  string,
        currentDir:  string,
        visited:     Set<string>,
    ): Promise<number> {
        if (groups.length === 0) return 0;
        fs.mkdirSync(currentDir, { recursive: true });

        let count = 0;
        for (const tree of groups) {
            const label    = tree.group.label ?? "groupe";
            const safeName = sanitizeFilename(label);
            const filePath = path.join(currentDir, `${safeName}.md`);
            const nestedDir = path.join(currentDir, safeName);

            const nodeKinds = this.collectNodeKinds(tree.nodes, tree.children);
            const content   = await this.buildMarkdown(
                label, tree.nodes, tree.children,
                canvas, nodeKinds, projectPath, filePath, nestedDir, parentPath,
            );
            fs.writeFileSync(filePath, content, "utf8");
            count++;

            // Canvas refs dans ce groupe
            for (const node of tree.nodes) {
                if (node.type !== "file" || !node.file?.endsWith(".canvas")) continue;
                const ref = this.app.vault.getAbstractFileByPath(node.file);
                if (!(ref instanceof TFile)) continue;
                const refSafe = sanitizeFilename(ref.basename);
                count += await this.processCanvas(
                    ref,
                    path.join(nestedDir, `${refSafe}.md`),
                    path.join(nestedDir, refSafe),
                    filePath, projectPath, visited,
                );
            }

            count += await this.writeGroupSubContexts(
                tree.children, canvas, projectPath, filePath, nestedDir, visited,
            );
        }
        return count;
    }

    // Lit les kinds depuis le metadataCache (sync, pas d'I/O)
    private collectNodeKinds(nodes: CanvasNode[], groups: GroupTree[]): Map<string, AnyKind> {
        const map = new Map<string, AnyKind>();
        const scan = (nodeList: CanvasNode[], groupList: GroupTree[]) => {
            for (const node of nodeList) {
                if (node.type !== "file" || !node.file || node.file.endsWith(".canvas")) continue;
                const tfile = this.app.vault.getAbstractFileByPath(node.file);
                if (!(tfile instanceof TFile)) continue;
                const fm = this.app.metadataCache.getFileCache(tfile)?.frontmatter;
                if (fm?.kind) map.set(node.id, fm.kind as AnyKind);
            }
            for (const g of groupList) scan(g.nodes, g.children);
        };
        scan(nodes, groups);
        return map;
    }

    private async buildMarkdown(
        title:       string,
        nodes:       CanvasNode[],
        subGroups:   GroupTree[],
        canvas:      CanvasData,
        nodeKinds:   Map<string, AnyKind>,
        projectPath: string,
        currentFile: string,
        subDir:      string,
        mainPath:    string | null,
    ): Promise<string> {
        const lines: string[] = [];
        const now = new Date().toLocaleDateString("fr-FR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        });

        const apiPath = path.join(projectPath, "KRYSTAL_API.md");

        lines.push(`# ${title}`);
        if (mainPath) lines.push(`_[← Contexte principal](${relPath(currentFile, mainPath)})_`);
        lines.push(`_Généré le ${now} · [→ Krystal API](${relPath(currentFile, apiPath)}) — comment interagir avec ce fichier_`);
        lines.push("");

        // Diagramme Mermaid
        lines.push(buildMermaidDiagram(nodes, subGroups, canvas.edges, nodeKinds));
        lines.push("");

        // Liens vers sous-graphes
        const canvasRefs = nodes.filter(
            (n): n is CanvasNode & { type: "file"; file: string } =>
                n.type === "file" && !!n.file && n.file.endsWith(".canvas"),
        );
        const subContextLinks = [
            ...subGroups.map(t => ({
                label: t.group.label ?? "groupe",
                file:  path.join(subDir, `${sanitizeFilename(t.group.label ?? "groupe")}.md`),
            })),
            ...canvasRefs.map(n => {
                const base = path.basename(n.file, ".canvas");
                return { label: base, file: path.join(subDir, `${sanitizeFilename(base)}.md`) };
            }),
        ];
        if (subContextLinks.length > 0) {
            lines.push("## Sous-graphes");
            lines.push("");
            for (const sc of subContextLinks) {
                lines.push(`- [${sc.label}](${relPath(currentFile, sc.file)})`);
            }
            lines.push("");
        }

        // Notes .md
        const mdNodes = nodes.filter(
            (n): n is CanvasNode & { type: "file"; file: string } =>
                n.type === "file" && !!n.file && !n.file.endsWith(".canvas"),
        );
        if (mdNodes.length > 0) {
            lines.push("## Composants");
            lines.push("");
            for (const node of mdNodes) {
                const rendered = await this.renderMdNode(node, canvas, nodeKinds.get(node.id), projectPath);
                lines.push(...rendered);
            }
        }

        // Text nodes
        const textNodes = nodes.filter(
            (n): n is CanvasNode & { type: "text"; text: string } => n.type === "text" && !!n.text,
        );
        if (textNodes.length > 0) {
            lines.push("## Notes");
            lines.push("");
            for (const node of textNodes) { lines.push(node.text.trim()); lines.push(""); }
        }

        // Link nodes
        const linkNodes = nodes.filter(
            (n): n is CanvasNode & { type: "link"; url: string } => n.type === "link" && !!n.url,
        );
        if (linkNodes.length > 0) {
            lines.push("## Liens externes");
            lines.push("");
            for (const node of linkNodes) lines.push(`- [${node.label ?? node.url}](${node.url})`);
            lines.push("");
        }

        // Footer
        const parts = [
            mdNodes.length   > 0 ? `${mdNodes.length} composant${mdNodes.length > 1 ? "s" : ""}`         : "",
            subContextLinks.length > 0 ? `${subContextLinks.length} sous-graphe${subContextLinks.length > 1 ? "s" : ""}` : "",
            textNodes.length > 0 ? `${textNodes.length} note${textNodes.length > 1 ? "s" : ""}`           : "",
        ].filter(Boolean);
        lines.push("---");
        lines.push(`_${parts.join(" · ") || "vide"}_`);

        return lines.join("\n");
    }

    private async renderMdNode(
        node:        CanvasNode & { file: string },
        canvas:      CanvasData,
        kind:        AnyKind | undefined,
        projectPath: string,
    ): Promise<string[]> {
        const lines: string[] = [];
        const tfile = this.app.vault.getAbstractFileByPath(node.file);

        if (!(tfile instanceof TFile) || tfile.extension !== "md") {
            lines.push(`### ${path.basename(node.file, path.extname(node.file))}`);
            lines.push(`_Fichier introuvable : \`${node.file}\`_`);
            lines.push("");
            return lines;
        }

        const raw = await this.app.vault.read(tfile);
        // Utilise le metadataCache pour le frontmatter structuré
        const fm  = this.app.metadataCache.getFileCache(tfile)?.frontmatter ?? {};
        const effectiveKind: AnyKind = (fm.kind as AnyKind | undefined) ?? kind ?? "component";

        const connections = canvas.edges
            .filter((e: CanvasEdge) => e.fromNode === node.id || e.toNode === node.id)
            .map((e: CanvasEdge) => {
                const otherId  = e.fromNode === node.id ? e.toNode : e.fromNode;
                const other    = canvas.nodes.find(n => n.id === otherId);
                const name     = other?.file
                    ? path.basename(other.file, path.extname(other.file))
                    : (other?.label ?? otherId);
                const dir   = e.fromNode === node.id ? "→" : "←";
                const label = e.label ? ` _(${e.label})_` : "";
                return `${dir} **${name}**${label}`;
            });

        const isFrozen  = fm.frozen === true;
        const isPlan    = kindCategory(effectiveKind) === "plan";
        const markers   = [
            isFrozen ? "frozen:true" : "",
            isPlan   ? "plan:true"   : "",
        ].filter(Boolean).join(" ");
        lines.push(`### ${tfile.basename} <!-- vault:${tfile.path}${markers ? " " + markers : ""} -->`);
        if (fm.file) {
            lines.push(`**Source :** [${fm.file}](vscode://file/${path.join(projectPath, fm.file as string)})`);
        }
        if (connections.length > 0) {
            lines.push(`**Relations :** ${connections.join(" · ")}`);
        }
        lines.push("");

        // Bloc structuré (généré depuis le frontmatter) — marqué pour que l'importer le saute
        const kindLines = this.renderKindBlock(effectiveKind, tfile.basename, fm);
        if (kindLines.length > 0) {
            lines.push("<!-- kind-block -->");
            lines.push(...kindLines);
            lines.push("<!-- /kind-block -->");
        }

        // Corps de la note (prose + blocs de code) — zone modifiable par l'IA
        // Les notes gelées (frozen:true) sont incluses en lecture seule
        const body = normalizeContent(raw);
        if (body) { lines.push(body); lines.push(""); }

        return lines;
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
                    for (const f of fields) {
                        lines.push(`  ${f.name}: ${f.type};${f.desc ? `  // ${f.desc}` : ""}`);
                    }
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
                    for (const v of values) {
                        lines.push(`  ${v.name},${v.desc ? `  // ${v.desc}` : ""}`);
                    }
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
            // --- PlanKind blocks ---
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
                const rows: string[] = [];
                if (fm.date)      rows.push(`**Date :** ${fm.date}`);
                if (rows.length) { lines.push(rows.join(" · ")); lines.push(""); }
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
            // spec, component, file, task (no structured block — prose only)
        }
        return lines;
    }
}
