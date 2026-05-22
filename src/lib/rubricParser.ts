/**
 * Thin re-export of the canonical shared parser.
 * Single source of truth lives in `supabase/functions/_shared/rubricParser.ts`
 * so the frontend and edge functions stay in sync.
 */
export * from "../../supabase/functions/_shared/rubricParser";
