export interface CanvasNode {
    id: string;
    type: "file" | "text" | "link" | "group";
    file?: string;
    text?: string;
    url?: string;
    label?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
}

export interface CanvasEdge {
    id: string;
    fromNode: string;
    fromSide?: "top" | "right" | "bottom" | "left";
    toNode: string;
    toSide?: "top" | "right" | "bottom" | "left";
    label?: string;
    color?: string;
}

export interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

export interface ContextGeneratorSettings {
    projectPath: string;
    canvasFile: string;
    outputFile: string;
}

// --- Kind system ---

// AI territory: code structure kinds
export type CodeKind =
    | "component"
    | "interface"
    | "type"
    | "enum"
    | "config"
    | "media"
    | "file";

// User territory: planning kinds (AI reads, does not modify without instruction)
export type PlanKind =
    | "epic"
    | "task"
    | "milestone"
    | "decision"
    | "question"
    | "spec";

export type AnyKind = CodeKind | PlanKind;

// Keep NoteKind as alias for backward compatibility with existing frontmatter
export type NoteKind = AnyKind;

export function kindCategory(k: AnyKind): "plan" | "code" {
    const planKinds: PlanKind[] = ["epic", "task", "milestone", "decision", "question", "spec"];
    return (planKinds as string[]).includes(k) ? "plan" : "code";
}

export interface NoteFrontmatter {
    file?: string;
    kind?: AnyKind;
    frozen?: boolean;
}
