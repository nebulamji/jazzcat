export declare const OPEN_SERVER: string;
export declare class NjcError extends Error { tool?: string; code?: string | number; }
export interface McpTool { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; }
export declare class NewJazzCity {
  constructor(opts?: { server?: string; timeoutMs?: number; fetch?: typeof fetch });
  server: string;
  tools(): Promise<McpTool[]>;
  call<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  brief<T = any>(): Promise<T>;
  cat<T = any>(n: number): Promise<T>;
  title<T = any>(q: { id: number } | { address: string }): Promise<T>;
  sendCheck<T = any>(from: string, to: string): Promise<T>;
  poisonCheck<T = any>(address: string): Promise<T>;
  jobs<T = any>(opts?: { board?: string; lane?: string; holder?: string }): Promise<T>;
  holder<T = any>(address: string): Promise<T>;
  marketEntry<T = any>(q: { id: number } | { address: string }): Promise<T>;
  find<T = any>(query: string): Promise<T>;
  tool<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  tradePlan<T = any>(p: { token: string; side?: 'buy' | 'sell'; amountIn: string | number | bigint; trader: string; chain?: string | number; slippageBps?: number }): Promise<T>;
  postJob<T = any>(job: { poster: string; title: string; spec: string; amount: string; escrow?: string; expiryHours?: number; at?: number; signature?: string }): Promise<T>;
}
export default NewJazzCity;
