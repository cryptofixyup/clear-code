// Typia generates optimized validators at build time via ts-patch transform.
// Throughput: ~10.5M ops/sec for primitives — 100x faster than Zod's interpreter.
//
// Setup (one-time):
//   1. npm install typia ts-patch
//   2. npx ts-patch install        (patches tsc to enable custom transforms)
//   3. tsconfig.json: plugins: [{ "transform": "typia/lib/transform" }]
//
// At build time each typia.createAssert<T>() call is replaced with optimized
// JS — no eval, no reflection, raw V8 execution speed.

import typia, { tags } from 'typia';

// ---------------------------------------------------------------------------
// Schema types — TypeScript branded types encode validation rules inline.
// The Typia transformer reads these at compile time to emit the validators.
// ---------------------------------------------------------------------------

export interface MetricQuery {
  metric: string & tags.MinLength<1> & tags.MaxLength<64> & tags.Pattern<'^[a-z_]+$'>;
  limit?: number & tags.Minimum<1> & tags.Maximum<1000> & tags.Type<'uint32'>;
  cursor?: string & tags.Format<'uuid'>;
}

export interface UserProfile {
  id: string & tags.Format<'uuid'>;
  email: string & tags.Format<'email'>;
  role: 'admin' | 'viewer' | 'editor';
  createdAt: string & tags.Format<'date-time'>;
}

// Edge auth token — validated in Server Components, NOT in middleware
export interface EdgeAuthToken {
  sub: string & tags.Format<'uuid'>;
  exp: number & tags.Type<'uint32'>;
  iat: number & tags.Type<'uint32'>;
  scope: string[];
}

// ---------------------------------------------------------------------------
// Compiled validators — these are replaced at build time with optimized code
// ---------------------------------------------------------------------------

export const assertMetricQuery    = typia.createAssert<MetricQuery>();
export const validateMetricQuery  = typia.createValidate<MetricQuery>();
export const assertUserProfile    = typia.createAssert<UserProfile>();
export const validateUserProfile  = typia.createValidate<UserProfile>();
export const assertEdgeAuthToken  = typia.createAssert<EdgeAuthToken>();
export const validateEdgeAuthToken = typia.createValidate<EdgeAuthToken>();

// ---------------------------------------------------------------------------
// Edge-auth fallback: @zod/mini for contexts where bundle size dominates
// (e.g., Cloudflare Workers with <1MB limit). ~5.5KB vs typia's 0KB overhead.
// ---------------------------------------------------------------------------
//
// import { z } from '@zod/mini';
// export const edgeTokenSchema = z.object({
//   sub: z.string(),
//   exp: z.number(),
//   iat: z.number(),
//   scope: z.array(z.string()),
// });
