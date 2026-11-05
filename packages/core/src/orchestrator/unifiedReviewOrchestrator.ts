import {
  ReviewTarget,
  ReviewConfig,
  ReviewResult,
  ReviewFinding,
  ReviewSummary,
  ReviewSeverity,
  ReviewCategory,
} from '@cr/shared';
import { GitClient } from '../git/gitClient.js';
import {
  LLMProvider,
  OllamaProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  CustomOpenAIProvider,
  createLLMProvider,
} from '../llm/provider.js';
import { HallucinationGuard } from '../guard/hallucinationGuard.js';
import { loadConfig } from '../config/configLoader.js';
import { SecretRedactor } from '../security/secretRedactor.js';
import { StaticAnalysisManager } from '../static/staticAnalysisManager.js';
import { FindingAggregator } from '../aggregation/findingAggregator.js';
import { RepositoryIndexer } from '../indexing/repositoryIndexer.js';
import { BlastRadiusResolver } from '../blastRadius/blastRadiusResolver.js';
import { ReviewMemory } from '../history/reviewMemory.js';
import { ApiContractAnalyzer, DatabaseMigrationAnalyzer } from '../history/advancedAnalyzers.js';
import { TeamRuleEngine } from '../enterprise/teamRules.js';
import { FallbackLLMProvider } from '../llm/fallbackProvider.js';
import { ArchitectureDriftAnalyzer } from '../autonomous/architectureDrift.js';

export interface OrchestratorOptions {
  cwd?: string;
  config?: ReviewConfig;
  configPath?: string;
  provider?: LLMProvider;
  agentProviders?: Partial<Record<ReviewCategory, LLMProvider>>;
  gitClient?: GitClient;
  hallucinationGuard?: HallucinationGuard;
  secretRedactor?: SecretRedactor;
  staticManager?: StaticAnalysisManager;
  aggregator?: FindingAggregator;
  indexer?: RepositoryIndexer;
  blastResolver?: BlastRadiusResolver;
  reviewMemory?: ReviewMemory;
  apiContractAnalyzer?: ApiContractAnalyzer;
  dbMigrationAnalyzer?: DatabaseMigrationAnalyzer;
  teamRuleEngine?: TeamRuleEngine;
}

export class UnifiedReviewOrchestrator {
  private readonly cwd: string;
  private configPromise: Promise<ReviewConfig>;
  private currentConfig?: ReviewConfig;
  private provider?: LLMProvider;
  private readonly agentProviders?: Partial<Record<ReviewCategory, LLMProvider>>;
  private readonly gitClient: GitClient;
  private readonly guard: HallucinationGuard;
  private readonly redactor: SecretRedactor;
  private readonly staticManager: StaticAnalysisManager;
  private readonly aggregator: FindingAggregator;
  private readonly indexer: RepositoryIndexer;
  private readonly blastResolver: BlastRadiusResolver;
  private readonly reviewMemory: ReviewMemory;
  private readonly apiContractAnalyzer: ApiContractAnalyzer;
  private readonly dbMigrationAnalyzer: DatabaseMigrationAnalyzer;
  private readonly teamRuleEngine: TeamRuleEngine;

  constructor(options: OrchestratorOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.gitClient = options.gitClient ?? new GitClient({ cwd: this.cwd });
    this.guard = options.hallucinationGuard ?? new HallucinationGuard({ repoRoot: this.cwd });
    this.redactor = options.secretRedactor ?? new SecretRedactor();
    this.staticManager = options.staticManager ?? new StaticAnalysisManager({ cwd: this.cwd });
    this.aggregator = options.aggregator ?? new FindingAggregator();
    this.indexer = options.indexer ?? new RepositoryIndexer({ repoRoot: this.cwd });
    this.blastResolver =
      options.blastResolver ?? new BlastRadiusResolver(this.indexer.getCodeGraph());
    this.reviewMemory = options.reviewMemory ?? new ReviewMemory(this.indexer.getStorage());
    this.apiContractAnalyzer =
      options.apiContractAnalyzer ?? new ApiContractAnalyzer(this.indexer.getCodeGraph());
    this.dbMigrationAnalyzer =
      options.dbMigrationAnalyzer ?? new DatabaseMigrationAnalyzer();
    this.teamRuleEngine = options.teamRuleEngine ?? new TeamRuleEngine({ repoRoot: this.cwd });
    this.provider = options.provider;
    this.agentProviders = options.agentProviders;

    if (options.config) {
      this.configPromise = Promise.resolve(options.config);
    } else {
      this.configPromise = loadConfig({
        cwd: this.cwd,
        configPath: options.configPath,
      }).then((res) => res.config);
    }
  }

  getReviewMemory(): ReviewMemory {
    return this.reviewMemory;
  }

  async getConfig(): Promise<ReviewConfig> {
    if (!this.currentConfig) {
      this.currentConfig = await this.configPromise;
    }
    return this.currentConfig;
  }

  updateConfig(updates: Partial<ReviewConfig>): void {
    if (this.currentConfig) {
      this.currentConfig = {
        ...this.currentConfig,
        ...updates,
      };
      this.configPromise = Promise.resolve(this.currentConfig);
    } else {
      this.configPromise = this.configPromise.then((prev) => {
        this.currentConfig = { ...prev, ...updates };
        return this.currentConfig;
      });
    }
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  async runReview(target: ReviewTarget): Promise<ReviewResult> {
    const startTime = Date.now();
    const config = await this.configPromise;

    // 1. Git Change Detection
    const diffReport = await this.gitClient.getDiff(target);

    // Filter files matching ignore patterns
    const filesToAnalyze = diffReport.files.filter((file) => {
      const p = file.newPath || file.oldPath || '';
      for (const pattern of config.review.ignorePaths) {
        if (this.simpleGlobMatch(p, pattern)) {
          return false;
        }
      }
      return true;
    });

    const changedPaths = filesToAnalyze
      .map((f) => f.newPath || f.oldPath)
      .filter((p): p is string => Boolean(p));

    // Incremental Re-indexing of modified files
    await this.indexer.reindexFiles(changedPaths).catch((err) => {
      console.warn(`[orchestrator] Indexing warning: ${(err as Error).message}`);
    });

    // 2. Select / Initialize Provider & Retrieve Learned Conventions
    const provider = this.provider ?? this.createProviderFromConfig(config);
    const conventionsContext = this.reviewMemory.getConventionsContext();

    // 3. Parallel Execution: Deterministic Static Analysis + Advanced Analyzers + AI Review Agents
    const staticAnalysisPromise = this.staticManager.runAll(changedPaths).catch((err) => {
      console.warn(`[orchestrator] Static analysis warning: ${(err as Error).message}`);
      return [] as ReviewFinding[];
    });

    // Run AST-based API Contract and Database Migration analyzers across changed diffs
    const advancedFindings: ReviewFinding[] = [];
    for (const fileDiff of filesToAnalyze) {
      advancedFindings.push(...this.apiContractAnalyzer.analyze(fileDiff));
      advancedFindings.push(...this.dbMigrationAnalyzer.analyze(fileDiff));
    }

    // Evaluate Team Rules (custom regex, forbidden functions, required headers)
    const teamRules = await this.teamRuleEngine.resolveAllRules(config.team?.rules, config.team?.rulepacks);
    const teamRuleFindings: ReviewFinding[] = [];
    if (teamRules.length > 0) {
      for (const fileDiff of filesToAnalyze) {
        teamRuleFindings.push(...this.teamRuleEngine.evaluate(fileDiff, teamRules));
      }
    }

    // Evaluate Architecture Drift, boundary rules & circular dependencies
    const driftAnalyzer = new ArchitectureDriftAnalyzer({
      codeGraph: this.indexer.getCodeGraph(),
      boundaryRules: config.boundaries,
    });
    const architectureDriftFindings = driftAnalyzer.analyze();

    const aiAnalysisPromise = (async () => {
      const aiFindings: ReviewFinding[] = [];

      for (const fileDiff of filesToAnalyze) {
        if (fileDiff.hunks.length === 0) continue;

        // Pre-egress secret scrubbing if in hybrid/cloud mode or enabled
        const shouldRedact =
          config.security.secretRedaction ||
          config.mode === 'cloud' ||
          config.mode === 'hybrid';

        const diffForLLM = shouldRedact
          ? this.redactor.redactFileDiff(fileDiff).redactedDiff
          : fileDiff;

        // Run specialized role-scoped agents across configured categories
        const agentPromises = config.review.categories.map((category) => {
          const catProvider = this.getProviderForCategory(category, config, provider);
          return catProvider.analyzeDiff(diffForLLM, config, category, { conventions: conventionsContext }).catch((err) => {
            console.warn(
              `[orchestrator] Agent [${category}] warning for ${fileDiff.newPath || fileDiff.oldPath}: ${
                (err as Error).message
              }`
            );
            return [] as ReviewFinding[];
          });
        });

        const agentResults = await Promise.all(agentPromises);
        const fileAIFindings = agentResults.flat();

        // Pass AI findings through the Hallucination Guard
        const guardResult = await this.guard.verifyFindings(fileAIFindings, fileDiff);
        aiFindings.push(...guardResult.verified);
      }

      return aiFindings;
    })();

    // Await both tracks running in parallel
    const [staticFindings, verifiedAIFindings] = await Promise.all([
      staticAnalysisPromise,
      aiAnalysisPromise,
    ]);

    // 4. Merge, Deduplicate & Score Findings via Aggregation Engine
    const allRawFindings = [
      ...staticFindings,
      ...advancedFindings,
      ...teamRuleFindings,
      ...architectureDriftFindings,
      ...verifiedAIFindings,
    ];
    const aggregatedFindings = this.aggregator.aggregate(allRawFindings);

    // 5. Review Memory: Suppress dismissed false-positive patterns
    const { active: activeFindings } = this.reviewMemory.filterIgnoredFindings(aggregatedFindings);

    // 6. Blast Radius Resolution & Downstream Route Impact
    const finalFindings = this.blastResolver.enrichFindings(activeFindings);

    // 6. Build Summary Metrics
    const bySeverity: Record<ReviewSeverity, number> = {
      critical: 0,
      major: 0,
      minor: 0,
      info: 0,
    };
    const byCategory: Record<ReviewCategory, number> = {
      bug: 0,
      security: 0,
      performance: 0,
      architecture: 0,
      quality: 0,
      testing: 0,
    };

    for (const f of finalFindings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    const durationMs = Date.now() - startTime;

    const summary: ReviewSummary = {
      target,
      executionMode: config.mode,
      modelName:
        config.mode === 'local'
          ? config.local.model
          : config.cloud.provider === 'openai'
            ? config.cloud.openai.model
            : config.cloud.anthropic.model,
      totalFindings: finalFindings.length,
      bySeverity,
      byCategory,
      filesAnalyzed: filesToAnalyze.length,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    return {
      summary,
      findings: finalFindings,
      diffReport,
    };
  }

  private createProviderFromConfig(config: ReviewConfig): LLMProvider {
    const localProvider = new OllamaProvider({
      endpoint: config.local.endpoint,
      model: config.local.model,
      timeoutMs: config.local.timeoutMs,
    });

    const createCloudProvider = () => {
      if (config.cloud.provider === 'anthropic') {
        return new AnthropicProvider({
          apiKey: config.cloud.anthropic.apiKey,
          model: config.cloud.anthropic.model,
          endpoint: config.cloud.anthropic.endpoint,
          timeoutMs: config.cloud.anthropic.timeoutMs,
        });
      }
      if (config.cloud.provider === 'gemini') {
        return new GeminiProvider({
          apiKey: config.cloud.gemini.apiKey,
          model: config.cloud.gemini.model,
          endpoint: config.cloud.gemini.endpoint,
          timeoutMs: config.cloud.gemini.timeoutMs,
        });
      }
      if (config.cloud.provider === 'custom') {
        return new CustomOpenAIProvider({
          apiKey: config.cloud.custom.apiKey,
          model: config.cloud.custom.model,
          endpoint: config.cloud.custom.endpoint,
          timeoutMs: config.cloud.custom.timeoutMs,
        });
      }
      return new OpenAIProvider({
        apiKey: config.cloud.openai.apiKey,
        model: config.cloud.openai.model,
        endpoint: config.cloud.openai.endpoint,
        timeoutMs: config.cloud.openai.timeoutMs,
      });
    };

    if (config.mode === 'cloud') {
      return createCloudProvider();
    }

    if (config.mode === 'hybrid') {
      const cloud = createCloudProvider();
      const secondaryLocalProviders = (config.fallback?.secondaryModels ?? []).map(
        (m: string) =>
          new OllamaProvider({
            endpoint: config.local.endpoint,
            model: m,
            timeoutMs: config.local.timeoutMs,
          })
      );
      return new FallbackLLMProvider({
        primary: localProvider,
        fallbacks: [...secondaryLocalProviders, cloud],
      });
    }

    // Local mode with optional secondary local models fallback
    if (config.fallback?.enabled && (config.fallback.secondaryModels?.length ?? 0) > 0) {
      const secondaryLocalProviders = (config.fallback.secondaryModels ?? []).map(
        (m: string) =>
          new OllamaProvider({
            endpoint: config.local.endpoint,
            model: m,
            timeoutMs: config.local.timeoutMs,
          })
      );
      return new FallbackLLMProvider({
        primary: localProvider,
        fallbacks: secondaryLocalProviders,
      });
    }

    return localProvider;
  }

  private getProviderForCategory(
    category: ReviewCategory,
    config: ReviewConfig,
    defaultProvider: LLMProvider
  ): LLMProvider {
    // 1. Programmatic option override
    if (this.agentProviders && this.agentProviders[category]) {
      return this.agentProviders[category]!;
    }

    // 2. Config file routing
    const agentConfig = config.agents?.[category];
    if (agentConfig && agentConfig.provider) {
      return createLLMProvider(agentConfig.provider, {
        apiKey: agentConfig.apiKey,
        model: agentConfig.model,
        endpoint: agentConfig.endpoint,
      });
    }

    return this.provider ?? defaultProvider;
  }

  private simpleGlobMatch(filePath: string, pattern: string): boolean {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return filePath.startsWith(prefix);
    }
    if (pattern.startsWith('**/')) {
      const suffix = pattern.slice(3);
      return filePath.endsWith(suffix) || filePath.includes(suffix);
    }
    return filePath === pattern;
  }
}
