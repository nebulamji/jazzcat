export declare const VERSION: string;
export declare const REGISTER: string;
export declare const TEXEL: { api: string; hours: string; credits: string; receipts: string };
export interface Proof { ok: boolean; id?: string; says?: string; why?: string; step?: string; [k: string]: unknown; }
export declare function verify(outputId: string, tx: string, opts?: { url?: string }): Promise<Proof>;
export declare function lint(body: string | Record<string, unknown>, opts?: { models?: unknown[] }): Promise<{ ok: boolean; problems: string[]; notes?: string[]; price?: Record<string, unknown>; [k: string]: unknown }>;
export declare function fingerprint(path: string): Promise<{ sha256: string; bytes: number }>;
export declare function lookup(sha256: string, opts?: { register?: string }): Promise<{ n: number; wallet: string; output?: unknown; paid?: unknown; proof?: string; page: string }[]>;
export declare function proveFile(path: string, opts?: { output?: string; tx?: string; register?: string }): Promise<Proof>;
export declare function sha256(data: string | ArrayBuffer | Uint8Array): Promise<string>;
export declare function canonical(v: unknown): string;
