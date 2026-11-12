import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { BadRequestError, ServiceUnavailableError } from '../utils/errors';
import { logger } from '../utils/logger';

const evidenceSchema = z.object({ path: z.string().min(1), reason: z.string().min(1) });
const findingSchema = z.object({ title: z.string().min(1), description: z.string().min(1), category: z.string().min(1), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).optional(), impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), mitigation: z.string().optional(), evidence: z.array(evidenceSchema).min(1) });
const analysisSchema = z.object({
  summary: z.string().min(1),
  architecture: z.object({ layers: z.array(z.string()).min(1), entrypoints: z.array(z.string()).min(1) }),
  modules: z.array(z.object({ name: z.string(), responsibility: z.string(), evidence: z.array(evidenceSchema).min(1) })).min(1),
  dependencies: z.array(z.object({ name: z.string(), purpose: z.string(), evidence: z.array(evidenceSchema).min(1) })),
  techDecisions: z.array(z.object({ decision: z.string(), rationale: z.string(), evidence: z.array(evidenceSchema).min(1) })),
  knowledgeGaps: z.array(findingSchema),
  risks: z.array(findingSchema),
  interviewQuestions: z.array(z.object({ question: z.string().min(1), category: z.string().min(1), evidence: z.array(evidenceSchema).min(1) })).min(1),
  handover: z.object({ title: z.string().min(1), markdown: z.string().min(1), evidence: z.array(evidenceSchema).min(1) }),
});
type AnalysisResult = z.infer<typeof analysisSchema>;

type SourceFile = { path: string; content: string; contentHash: string | null; language: string | null; isTest: boolean; isConfig: boolean; isDocumentation: boolean };

const sourcePriority = (file: SourceFile): number => {
  if (/^(README|docs\/ARCHITECTURE|docs\/API|apps\/backend\/prisma\/schema|package\.json)/.test(file.path)) return 0;
  if (/(index|app|routes|controllers|services|config|middleware)/.test(file.path)) return 1;
  if (file.isConfig) return 2;
  if (file.isTest) return 3;
  return 4;
};

const cleanJson = (content: string): string => content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

const validateEvidence = (result: AnalysisResult, paths: Set<string>): void => {
  const validate = (evidence: Array<{ path: string }>) => evidence.forEach(item => { if (!paths.has(item.path)) throw new BadRequestError(`Analysis returned unsupported evidence path: ${item.path}`); });
  result.modules.forEach(item => validate(item.evidence));
  result.dependencies.forEach(item => validate(item.evidence));
  result.techDecisions.forEach(item => validate(item.evidence));
  result.knowledgeGaps.forEach(item => validate(item.evidence));
  result.risks.forEach(item => validate(item.evidence));
  result.interviewQuestions.forEach(item => validate(item.evidence));
  validate(result.handover.evidence);
  result.architecture.entrypoints.forEach(path => { if (!paths.has(path)) throw new BadRequestError(`Architecture returned unsupported entrypoint: ${path}`); });
};

async function requestAnalysis(files: SourceFile[]): Promise<AnalysisResult> {
  if (!config.LLM_API_KEY) throw new ServiceUnavailableError('LLM_API_KEY is not configured. Set a valid OpenAI-compatible API key and restart the backend before running analysis.');
  const selected = [...files].sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.path.localeCompare(b.path));
  const budget = 120_000;
  let used = 0;
  const packet = selected.flatMap(file => {
    const remaining = budget - used;
    if (remaining <= 0) return [];
    const content = file.content.slice(0, Math.min(file.content.length, remaining));
    used += content.length;
    return [`<file path="${file.path}" sha="${file.contentHash || ''}" language="${file.language || ''}">\n${content}\n</file>`];
  }).join('\n');
  const prompt = `You are analyzing an ingested source repository. Use only the supplied files. Return JSON only matching this exact shape: {summary,architecture:{layers:string[],entrypoints:string[]},modules:[{name,responsibility,evidence:[{path,reason}]}],dependencies:[{name,purpose,evidence}],techDecisions:[{decision,rationale,evidence}],knowledgeGaps:[{title,description,category,severity,evidence}],risks:[{title,description,category,likelihood,impact,mitigation,evidence}],interviewQuestions:[{question,category,evidence}],handover:{title,markdown,evidence}}. Every evidence.path and architecture.entrypoints item must exactly match a supplied file path. Do not claim facts that lack supplied-file evidence. Use gaps/risks for uncertainty or observable technical concerns only.\n\n${packet}`;
  const baseUrl = config.LLM_BASE_URL || 'https://api.openai.com/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.LLM_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.LLM_MODEL, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You are a cautious software handover analyst. Return valid JSON only.' }, { role: 'user', content: prompt }] }) });
  if (!response.ok) {
    const providerBody = await response.text();
    let providerErrorCode: string | undefined;
    let providerErrorMessage = providerBody;
    try {
      const parsed = JSON.parse(providerBody) as { error?: { code?: string; message?: string } };
      providerErrorCode = parsed.error?.code;
      providerErrorMessage = parsed.error?.message || providerBody;
    } catch {
      // Preserve a non-JSON provider response as diagnostic text.
    }
    logger.error('LLM provider analysis request failed', {
      providerStatus: response.status,
      providerErrorCode,
      providerErrorMessage,
    });
    throw new ServiceUnavailableError(`LLM analysis request failed (${response.status}). Check LLM_API_KEY, LLM_BASE_URL, model access, and provider availability.`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new ServiceUnavailableError('LLM response did not contain analysis content.');
  return analysisSchema.parse(JSON.parse(cleanJson(content)));
}

export async function analyzeProject(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, include: { repositories: { include: { ingestions: { where: { status: 'COMPLETED' }, take: 1 } } } } });
  if (!project) throw new BadRequestError('Project not found or not owned by the authenticated user');
  const repositoryIds = project.repositories.filter(repository => repository.ingestions.length > 0).map(repository => repository.id);
  if (!repositoryIds.length) throw new BadRequestError('A completed repository ingestion is required before analysis.');
  const files = await prisma.repositoryFile.findMany({ where: { repositoryId: { in: repositoryIds }, content: { not: null }, isBinary: false, isGenerated: false }, select: { path: true, content: true, contentHash: true, language: true, isTest: true, isConfig: true, isDocumentation: true } });
  const sourceFiles = files.filter((file): file is SourceFile => file.content !== null);
  if (!sourceFiles.length) throw new BadRequestError('No persisted source content is available for analysis.');
  const analysis = await requestAnalysis(sourceFiles);
  validateEvidence(analysis, new Set(sourceFiles.map(file => file.path)));
  const evidenceRows = analysis.handover.evidence.map(evidence => ({ type: 'SOURCE_CODE', source: evidence.path, reference: evidence.reason, description: evidence.reason, confidence: 0.85 }));
  return prisma.$transaction(async tx => {
    const saved = await tx.projectAnalysis.create({ data: { projectId, status: 'COMPLETED', summary: analysis.summary, architecture: JSON.stringify(analysis.architecture), modules: JSON.stringify(analysis.modules), dependencies: JSON.stringify(analysis.dependencies), contributors: JSON.stringify([]), techDecisions: JSON.stringify(analysis.techDecisions), startedAt: new Date(), completedAt: new Date() } });
    for (const gap of analysis.knowledgeGaps) await tx.knowledgeGap.create({ data: { projectId, title: gap.title, description: `${gap.description}\nEvidence: ${gap.evidence.map(e => e.path).join(', ')}`, category: gap.category, severity: gap.severity || 'MEDIUM', filePaths: JSON.stringify(gap.evidence.map(e => e.path)) } });
    for (const risk of analysis.risks) await tx.projectRisk.create({ data: { projectId, title: risk.title, description: `${risk.description}\nEvidence: ${risk.evidence.map(e => e.path).join(', ')}`, category: risk.category, likelihood: risk.likelihood || 'MEDIUM', impact: risk.impact || 'MEDIUM', mitigation: risk.mitigation } });
    const interview = await tx.interview.create({ data: { projectId, intervieweeId: userId, status: 'SCHEDULED', type: 'KNOWLEDGE_TRANSFER', summary: 'AI-generated successor handover questions grounded in the latest repository ingestion.' } });
    for (const [order, question] of analysis.interviewQuestions.entries()) await tx.interviewQuestion.create({ data: { interviewId: interview.id, question: `${question.question}\nEvidence: ${question.evidence.map(e => e.path).join(', ')}`, category: question.category, order: order + 1 } });
    const document = await tx.handoverDocument.create({ data: { projectId, authorId: userId, title: analysis.handover.title, status: 'DRAFT', generatedBy: 'AI_GENERATED', content: JSON.stringify({ summary: analysis.summary, architecture: analysis.architecture, modules: analysis.modules, dependencies: analysis.dependencies, techDecisions: analysis.techDecisions, unresolvedQuestions: analysis.interviewQuestions }), markdown: analysis.handover.markdown, evidence: { create: evidenceRows } } });
    return { analysisId: saved.id, documentId: document.id, interviewId: interview.id, analyzedFiles: sourceFiles.length };
  });
}
