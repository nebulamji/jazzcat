export declare const OAK_PROJECT: string;
export interface OakRecipe { schema: 'oak-recipe/v1'; project: string; name: string; description: string; chainId: number; contract: string; function: Record<string, unknown>; inputs: { name: string; type: string; description?: string }[]; kind: 'read' | 'tx'; approve?: Record<string, unknown>; [k: string]: unknown; }
export declare function recipes(): OakRecipe[];
export declare function recipe(name: string): OakRecipe | null;
export declare function writeRecipes(dir: string): string[];
