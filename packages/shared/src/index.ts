import { z } from 'zod';

// ==========================================
// 1. Core Domain Schemas & Types (Section 6)
// ==========================================

export const ExecutionModeSchema = z.enum(['local', 'hybrid', 'cloud']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const ReviewSeveritySchema = z.enum(['critical', 'major', 'minor', 'info']);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewCategorySchema = z.enum([
  'bug',
  'security',
  'performance',
  'architecture',
  'quality',
  'testing',
]);
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const ReviewTargetTypeSchema = z.enum(['staged', 'unstaged', 'commit', 'branch', 'files']);
export type ReviewTargetType = z.infer<typeof ReviewTargetTypeSchema>;

export const ReviewTargetSchema = z.object({
  type: ReviewTargetTypeSchema,
  ref: z.string().optional(),
  baseRef: z.string().optional(),
  paths: z.array(z.string()).optional(),
});
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

export const VerificationMethodSchema = z.enum(['ast', 'tsc', 'eslint', 'semgrep', 'llm', 'team-rule']);
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

export const ReviewFindingSchema = z.object({
  id: z.string(),
  category: ReviewCategorySchema,
  severity: ReviewSeveritySchema,
  confidence: z.number().min(0).max(1),
  filePath: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbolName: z.string().optional(),
  title: z.string(),
  explanation: z.string(),
  evidence: z.string(),
  blastRadius: z.array(z.string()).optional(),
  suggestedPatch: z.string().optional(),
  suggestedTest: z.string().optional(),
  verifiedBy: z.array(VerificationMethodSchema).default(['llm']),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

// ==========================================
// 2. Git & Diff Structures
// ==========================================

export const GitHunkSchema = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  header: z.string(),
  lines: z.array(z.string()),
});
export type GitHunk = z.infer<typeof GitHunkSchema>;

export const FileDiffStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed']);
export type FileDiffStatus = z.infer<typeof FileDiffStatusSchema>;

export const FileDiffSchema = z.object({
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
  status: FileDiffStatusSchema,
  hunks: z.array(GitHunkSchema),
  raw: z.string(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

export const DiffReportSchema = z.object({
  target: ReviewTargetSchema,
  files: z.array(FileDiffSchema),
  totalInsertions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
});
export type DiffReport = z.infer<typeof DiffReportSchema>;

// ==========================================
// 3. Configuration Schema (.cr.yaml)
// ==========================================

export const LocalLLMConfigSchema = z.object({
  endpoint: z.string().default('http://127.0.0.1:11434'),
  model: z.string().default('qwen2.5-coder:7b'),
  timeoutMs: z.number().int().positive().default(60000),
  contextWindowTokens: z.number().int().positive().default(8192),
});
export type LocalLLMConfig = z.infer<typeof LocalLLMConfigSchema>;

export const ReviewRuleConfigSchema = z.object({
  minConfidence: z.number().min(0).max(1).default(0.7),
  maxFindingsPerFile: z.number().int().positive().default(10),
  categories: z.array(ReviewCategorySchema).default([
    'bug',
    'security',
    'performance',
    'architecture',
    'quality',
    'testing',
  ]),
  ignorePaths: z.array(z.string()).default([
    'node_modules/**',
    'dist/**',
    '**/*.lock',
    '**/*.min.*',
  ]),
});
export type ReviewRuleConfig = z.infer<typeof ReviewRuleConfigSchema>;

export const ReporterFormatSchema = z.enum(['terminal', 'json', 'markdown', 'html']);
export type ReporterFormat = z.infer<typeof ReporterFormatSchema>;

export const CloudOpenAIConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('gpt-4o'),
  endpoint: z.string().default('https://api.openai.com/v1'),
  timeoutMs: z.number().int().positive().default(60000),
});
export type CloudOpenAIConfig = z.infer<typeof CloudOpenAIConfigSchema>;

export const CloudAnthropicConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('claude-3-5-sonnet-20241022'),
  endpoint: z.string().default('https://api.anthropic.com/v1'),
  timeoutMs: z.number().int().positive().default(60000),
});
export type CloudAnthropicConfig = z.infer<typeof CloudAnthropicConfigSchema>;

export const CloudLLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  openai: CloudOpenAIConfigSchema.default({}),
  anthropic: CloudAnthropicConfigSchema.default({}),
});
export type CloudLLMConfig = z.infer<typeof CloudLLMConfigSchema>;

export const StaticAnalysisConfigSchema = z.object({
  enableTsc: z.boolean().default(true),
  enableEslint: z.boolean().default(true),
  enableSemgrep: z.boolean().default(true),
});
export type StaticAnalysisConfig = z.infer<typeof StaticAnalysisConfigSchema>;

export const SecurityConfigSchema = z.object({
  secretRedaction: z.boolean().default(true),
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export const TeamRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: ReviewCategorySchema.default('security'),
  severity: ReviewSeveritySchema.default('major'),
  pattern: z.string().optional(),
  forbiddenFunctions: z.array(z.string()).optional(),
  requiredHeaders: z.array(z.string()).optional(),
  filePattern: z.string().optional(),
  explanation: z.string(),
  suggestedPatch: z.string().optional(),
});
export type TeamRule = z.infer<typeof TeamRuleSchema>;

export const TeamRulepackSchema = z.object({
  name: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  extends: z.array(z.string()).optional(),
  rules: z.array(TeamRuleSchema).default([]),
});
export type TeamRulepack = z.infer<typeof TeamRulepackSchema>;

export const TeamConfigSchema = z.object({
  rulepacks: z.array(z.string()).default([]),
  rules: z.array(TeamRuleSchema).default([]),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const FallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  secondaryModels: z.array(z.string()).default([]),
});
export type FallbackConfig = z.infer<typeof FallbackConfigSchema>;

export const PackageBoundaryRuleSchema = z.object({
  packagePath: z.string(),
  disallowedImports: z.array(z.string()),
  explanation: z.string(),
});
export type PackageBoundaryRule = z.infer<typeof PackageBoundaryRuleSchema>;

export const WebhookEventSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'generic']),
  event: z.string(),
  repoName: z.string(),
  branch: z.string(),
  baseBranch: z.string().default('main'),
  commitSha: z.string().optional(),
  sender: z.string().optional(),
  prNumber: z.number().optional(),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WebhookAnnotationSchema = z.object({
  path: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  annotation_level: z.enum(['failure', 'warning', 'notice']),
  title: z.string(),
  message: z.string(),
  raw_details: z.string().optional(),
});
export type WebhookAnnotation = z.infer<typeof WebhookAnnotationSchema>;

export const WebhookCheckRunResponseSchema = z.object({
  status: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z.enum(['success', 'failure', 'neutral']),
  title: z.string(),
  summary: z.string(),
  annotationsCount: z.number(),
  annotations: z.array(WebhookAnnotationSchema),
});
export type WebhookCheckRunResponse = z.infer<typeof WebhookCheckRunResponseSchema>;

export const ReviewConfigSchema = z.object({
  version: z.number().default(1),
  mode: ExecutionModeSchema.default('local'),
  local: LocalLLMConfigSchema.default({}),
  cloud: CloudLLMConfigSchema.default({}),
  staticAnalysis: StaticAnalysisConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  team: TeamConfigSchema.default({}),
  fallback: FallbackConfigSchema.default({}),
  boundaries: z.array(PackageBoundaryRuleSchema).default([]),
  target: z.object({
    defaultType: ReviewTargetTypeSchema.default('staged'),
  }).default({}),
  review: ReviewRuleConfigSchema.default({}),
  reporter: z.object({
    defaultFormat: ReporterFormatSchema.default('terminal'),
  }).default({}),
});
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;

export const TelemetryRecordSchema = z.object({
  findingId: z.string(),
  category: ReviewCategorySchema,
  ruleTitle: z.string(),
  decision: z.enum(['accepted', 'ignored']),
  timestamp: z.string(),
});
export type TelemetryRecord = z.infer<typeof TelemetryRecordSchema>;

export const CategoryTelemetryStatsSchema = z.object({
  accepted: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  acceptanceRate: z.number().min(0).max(1),
});
export type CategoryTelemetryStats = z.infer<typeof CategoryTelemetryStatsSchema>;

// ==========================================
// 4. Review Run Summary & Aggregation
// ==========================================

export const ReviewSummarySchema = z.object({
  target: ReviewTargetSchema,
  executionMode: ExecutionModeSchema,
  modelName: z.string(),
  totalFindings: z.number().int().nonnegative(),
  bySeverity: z.record(ReviewSeveritySchema, z.number().int().nonnegative()),
  byCategory: z.record(ReviewCategorySchema, z.number().int().nonnegative()),
  filesAnalyzed: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  timestamp: z.string(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const ReviewResultSchema = z.object({
  summary: ReviewSummarySchema,
  findings: z.array(ReviewFindingSchema),
  diffReport: DiffReportSchema,
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ==========================================
// 5. Constants & Helpers
// ==========================================

export const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  info: 1,
};

export const CATEGORY_PREFIXES: Record<ReviewCategory, string> = {
  bug: 'BUG',
  security: 'SEC',
  performance: 'PERF',
  architecture: 'ARCH',
  quality: 'QUAL',
  testing: 'TEST',
};

export function compareSeverity(a: ReviewSeverity, b: ReviewSeverity): number {
  return (SEVERITY_ORDER[b] ?? 0) - (SEVERITY_ORDER[a] ?? 0);
}

export function generateFindingId(category: ReviewCategory, index: number): string {
  const prefix = CATEGORY_PREFIXES[category] ?? 'FIND';
  return `${prefix}-${String(index).padStart(3, '0')}`;
}
