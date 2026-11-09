export type FileType = "html" | "css" | "js" | "json" | "asset" | "api";
export type EdgeKind =
  | "imports"
  | "links-stylesheet"
  | "loads-script"
  | "references-asset"
  | "calls-api";
export type Confidence = "certain" | "possible";

export interface Node {
  /** Stable project-relative path; API nodes use `api:<url>`. */
  id: string;
  path: string;
  type: FileType;
  label: string;
}

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  line: number;
  confidence: Confidence;
}

export interface Graph {
  nodes: Map<string, Node>;
  edges: Edge[];
  /** Outgoing edges, keyed by source node id. */
  forward: Map<string, Edge[]>;
  /** Incoming edges, keyed by target node id. */
  reverse: Map<string, Edge[]>;
}

export interface Reference {
  specifier: string;
  line: number;
  kind: EdgeKind;
  confidence: Confidence;
  unresolved?: boolean;
}

export interface ImpactPathStep {
  from: string;
  to: string;
  kind: EdgeKind;
  line: number;
  confidence: Confidence;
}

export interface ImpactResult {
  nodeId: string;
  depth: number;
  path: ImpactPathStep[];
  confidence: Confidence;
}
