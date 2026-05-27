import type { AnyKind } from "./types";

// --- Parsed types ---

export interface ParsedMermaidNode {
    id:    string;
    label: string;
    kind?: AnyKind;
}

export interface ParsedMermaidEdge {
    from:   string;
    to:     string;
    label?: string;
}

export interface ParsedMermaidSubgraph {
    id:      string;       // canvas group ID (G_ prefix stripped)
    label:   string;
    nodeIds: string[];     // direct child node/subgraph IDs
}

export interface ParsedMermaidGraph {
    nodes:     ParsedMermaidNode[];
    edges:     ParsedMermaidEdge[];
    subgraphs: ParsedMermaidSubgraph[];
}

// --- Regexes (for our controlled Mermaid format only) ---

// Node: id<shape_open>"label"<shape_close> optionally :::class
// Shape opens: [, [[, {{, [/, {, [(, (, ([, ((
// Shape closes: ], ]], }}, /], }, )], ), ]), ))
const NODE_RE     = /^[ \t]*([A-Za-z0-9_-]+)[(\[{]+[/\\]?"([^"]*)"[/\\]?[)\]}\s]*(?:::(\w[\w-]*))?[ \t]*$/;
// Gateway: id:::gw (no shape)
const GATEWAY_RE  = /^[ \t]*([A-Za-z0-9_-]+):::gw[ \t]*$/;
// Edge: id --> id or id -->|"label"| id
const EDGE_RE     = /^[ \t]*([A-Za-z0-9_-]+)[ \t]*-->(?:\|"([^"]*)"\|)?[ \t]*([A-Za-z0-9_-]+)[ \t]*$/;
// Subgraph opening: subgraph G_<id>["label"]
const SUBGRAPH_RE = /^[ \t]*subgraph[ \t]+G_([A-Za-z0-9_-]+)\["([^"]*)"\][ \t]*$/;
// Lines to skip entirely
const SKIP_RE     = /^[ \t]*(?:```|classDef|flowchart|%%)/;

// --- Parser ---

export function parseMermaid(block: string): ParsedMermaidGraph {
    const nodes:     ParsedMermaidNode[]    = [];
    const edges:     ParsedMermaidEdge[]    = [];
    const subgraphs: ParsedMermaidSubgraph[] = [];

    const seenNodes    = new Set<string>();
    const subgraphStack: ParsedMermaidSubgraph[] = [];

    for (const raw of block.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
        const line = raw.trimEnd();
        if (!line.trim() || SKIP_RE.test(line)) continue;

        if (line.trim() === "end") {
            subgraphStack.pop();
            continue;
        }

        // Subgraph opening
        const sgm = line.match(SUBGRAPH_RE);
        if (sgm) {
            const sg: ParsedMermaidSubgraph = { id: sgm[1], label: sgm[2], nodeIds: [] };
            if (subgraphStack.length > 0) {
                subgraphStack[subgraphStack.length - 1].nodeIds.push(sgm[1]);
            }
            subgraphs.push(sg);
            subgraphStack.push(sg);
            continue;
        }

        // Gateway node (skip — it's just the invisible anchor for the group)
        if (GATEWAY_RE.test(line)) continue;

        // Edge (must be tested before node, since edges also contain identifiers)
        const em = line.match(EDGE_RE);
        if (em) {
            edges.push({ from: em[1], to: em[3], label: em[2] || undefined });
            continue;
        }

        // Node definition
        const nm = line.match(NODE_RE);
        if (nm && !seenNodes.has(nm[1])) {
            seenNodes.add(nm[1]);
            const rawClass = nm[3];
            const kind     = rawClass && rawClass !== "gw" ? rawClass as AnyKind : undefined;
            nodes.push({ id: nm[1], label: nm[2], kind });
            if (subgraphStack.length > 0) {
                subgraphStack[subgraphStack.length - 1].nodeIds.push(nm[1]);
            }
        }
    }

    return { nodes, edges, subgraphs };
}

/** Extract the first ```mermaid ... ``` block from a markdown string. */
export function extractMermaidBlock(markdown: string): string | null {
    const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const m = normalized.match(/```mermaid\n([\s\S]*?)\n```/);
    return m ? m[1] : null;
}
