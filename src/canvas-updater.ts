import { App, FileView, Notice, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type { CanvasData, CanvasNode, ContextGeneratorSettings } from "./types";
import { parseMermaid, extractMermaidBlock, ParsedMermaidGraph } from "./mermaid-parser";

interface SyncResult {
    added:      number;
    updated:    number;
    edgesAdded: number;
}

function generateId(): string {
    return Math.random().toString(36).slice(2, 18);
}

// Topological BFS layout for new nodes, placed to the right of existing content
function autoLayout(
    newNodeIds: string[],
    allEdges:   { from: string; to: string }[],
    existing:   CanvasNode[],
): Map<string, { x: number; y: number }> {
    const SPACING_X = 320;
    const SPACING_Y = 220;

    let maxX = 0, minY = 0;
    for (const n of existing) {
        maxX = Math.max(maxX, n.x + n.width);
        minY = Math.min(minY, n.y);
    }
    const startX = existing.length > 0 ? maxX + SPACING_X : 0;

    const newSet   = new Set(newNodeIds);
    const outgoing = new Map<string, string[]>();
    const inCount  = new Map<string, number>();
    for (const id of newNodeIds) { outgoing.set(id, []); inCount.set(id, 0); }
    for (const e of allEdges) {
        if (newSet.has(e.from) && newSet.has(e.to)) {
            outgoing.get(e.from)!.push(e.to);
            inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
        }
    }

    const depth  = new Map<string, number>();
    const queue  = newNodeIds.filter(id => (inCount.get(id) ?? 0) === 0);
    for (const id of queue) depth.set(id, 0);

    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        for (const next of outgoing.get(cur) ?? []) {
            const d = (depth.get(cur) ?? 0) + 1;
            if (!depth.has(next) || depth.get(next)! < d) {
                depth.set(next, d);
                queue.push(next);
            }
        }
    }
    for (const id of newNodeIds) { if (!depth.has(id)) depth.set(id, 0); }

    const byDepth = new Map<number, string[]>();
    for (const [id, d] of depth) {
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d)!.push(id);
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const [d, ids] of byDepth) {
        ids.forEach((id, row) => {
            positions.set(id, { x: startX + d * SPACING_X, y: minY + row * SPACING_Y });
        });
    }
    return positions;
}

function applyDiff(canvas: CanvasData, graph: ParsedMermaidGraph): SyncResult {
    const result: SyncResult = { added: 0, updated: 0, edgesAdded: 0 };
    const byId = new Map<string, CanvasNode>(canvas.nodes.map(n => [n.id, n]));

    // Nodes
    const newIds: string[] = [];
    for (const mn of graph.nodes) {
        const existing = byId.get(mn.id);
        if (existing) {
            if (existing.type === "text" && existing.text !== mn.label) {
                existing.text = mn.label;
                result.updated++;
            } else if (existing.type === "group" && existing.label !== mn.label) {
                existing.label = mn.label;
                result.updated++;
            }
        } else {
            newIds.push(mn.id);
        }
    }

    if (newIds.length > 0) {
        const positions = autoLayout(newIds, graph.edges, canvas.nodes);
        for (const id of newIds) {
            const mn  = graph.nodes.find(n => n.id === id)!;
            const pos = positions.get(id) ?? { x: 0, y: 0 };
            canvas.nodes.push({ id, type: "text", text: mn.label, x: pos.x, y: pos.y, width: 250, height: 60 });
            result.added++;
        }
    }

    // Edges
    const existingEdgeKeys = new Set(canvas.edges.map(e => `${e.fromNode}→${e.toNode}`));
    const allIds = new Set(canvas.nodes.map(n => n.id));
    for (const me of graph.edges) {
        const key = `${me.from}→${me.to}`;
        if (existingEdgeKeys.has(key) || !allIds.has(me.from) || !allIds.has(me.to)) continue;
        canvas.edges.push({ id: generateId(), fromNode: me.from, toNode: me.to, label: me.label });
        result.edgesAdded++;
    }

    return result;
}

export class CanvasUpdater {
    constructor(
        private readonly app: App,
        private readonly settings: ContextGeneratorSettings,
    ) {}

    async syncFromMermaid(): Promise<void> {
        const canvasFile = this.getActiveCanvasFile();
        if (!canvasFile) { new Notice("⚠️ Aucun canvas ouvert."); return; }

        const contextPath = this.resolveContextPath();
        if (!contextPath) return;

        let markdown: string;
        try {
            markdown = fs.readFileSync(contextPath, "utf8");
        } catch {
            new Notice(`⚠️ CONTEXT.md introuvable : ${contextPath}`);
            return;
        }

        const mermaidBlock = extractMermaidBlock(markdown);
        if (!mermaidBlock) { new Notice("⚠️ Aucun bloc Mermaid trouvé dans CONTEXT.md."); return; }

        const graph  = parseMermaid(mermaidBlock);
        const raw    = await this.app.vault.read(canvasFile);
        const canvas: CanvasData = JSON.parse(raw);

        const result = applyDiff(canvas, graph);

        await this.app.vault.modify(canvasFile, JSON.stringify(canvas, null, 2));

        const parts = [
            result.added      > 0 ? `${result.added} nœud${result.added > 1 ? "s" : ""} ajouté${result.added > 1 ? "s" : ""}` : "",
            result.updated    > 0 ? `${result.updated} mis à jour` : "",
            result.edgesAdded > 0 ? `${result.edgesAdded} lien${result.edgesAdded > 1 ? "s" : ""} ajouté${result.edgesAdded > 1 ? "s" : ""}` : "",
        ].filter(Boolean);

        new Notice(parts.length > 0
            ? `✅ Canvas synchronisé — ${parts.join(", ")}`
            : "✅ Canvas déjà à jour.");
    }

    private getActiveCanvasFile(): TFile | null {
        // Prefer the currently open canvas view
        const leaf = this.app.workspace.activeLeaf;
        if (leaf?.view.getViewType() === "canvas") {
            const file = (leaf.view as FileView).file;
            if (file instanceof TFile) return file;
        }
        // Fallback: canvas configured in settings
        const { canvasFile } = this.settings;
        if (!canvasFile) {
            new Notice("⚠️ Aucun canvas ouvert ni configuré dans les settings.");
            return null;
        }
        const f = this.app.vault.getAbstractFileByPath(canvasFile);
        if (!(f instanceof TFile)) {
            new Notice(`⚠️ Canvas introuvable : ${canvasFile}`);
            return null;
        }
        return f;
    }

    private resolveContextPath(): string | null {
        const { projectPath, outputFile } = this.settings;
        if (!projectPath) { new Notice("⚠️ Chemin projet non configuré dans les settings."); return null; }
        const { adapter } = this.app.vault;
        const vaultPath = "getBasePath" in adapter
            ? (adapter as { getBasePath(): string }).getBasePath()
            : "";
        return path.join(path.resolve(vaultPath, projectPath), outputFile);
    }
}
