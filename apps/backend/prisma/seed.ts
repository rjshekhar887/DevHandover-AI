import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demoEmail = process.env.DEMO_USER_EMAIL || 'demo@devhandover.ai';

const now = new Date();
const demoProjectId = 'cmh7x9pqa0001x1l8zj5v4r2a';

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { name: 'Alex Morgan' },
    create: { email: demoEmail, name: 'Alex Morgan' },
  });

  const workspace = await prisma.workspace.upsert({
    where: { id: 'demo-workspace-devhandover' },
    update: { name: 'Atlas Engineering', description: 'Demo workspace for the DevHandover AI MVP' },
    create: { id: 'demo-workspace-devhandover', name: 'Atlas Engineering', description: 'Demo workspace for the DevHandover AI MVP' },
  });

  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: 'OWNER' },
    create: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });

  const legacyProject = await prisma.project.findFirst({
    where: { name: 'Atlas Checkout Platform', repositoryUrl: 'https://github.com/atlas-demo/checkout-platform' },
  });
  if (legacyProject && legacyProject.id !== demoProjectId) {
    await prisma.project.delete({ where: { id: legacyProject.id } });
  }

  const project = await prisma.project.upsert({
    where: { id: demoProjectId },
    update: {
      name: 'Atlas Checkout Platform',
      description: 'A modular commerce checkout service being prepared for team handover.',
      repositoryUrl: 'https://github.com/atlas-demo/checkout-platform',
      defaultBranch: 'main', language: 'TypeScript', framework: 'React + Express', ownerId: user.id, workspaceId: workspace.id,
    },
    create: {
      id: demoProjectId, name: 'Atlas Checkout Platform',
      description: 'A modular commerce checkout service being prepared for team handover.',
      repositoryUrl: 'https://github.com/atlas-demo/checkout-platform', defaultBranch: 'main',
      language: 'TypeScript', framework: 'React + Express', ownerId: user.id, workspaceId: workspace.id,
    },
  });

  const repository = await prisma.repository.upsert({
    where: { githubId: '9001001' },
    update: { projectId: project.id, name: 'checkout-platform', fullName: 'atlas-demo/checkout-platform', url: 'https://github.com/atlas-demo/checkout-platform', cloneUrl: 'https://github.com/atlas-demo/checkout-platform.git', defaultBranch: 'main', language: 'TypeScript', description: 'Atlas demo commerce checkout platform', size: 12480, stargazersCount: 18, forksCount: 4, openIssuesCount: 3, githubCreatedAt: now, githubUpdatedAt: now },
    create: { githubId: '9001001', projectId: project.id, name: 'checkout-platform', fullName: 'atlas-demo/checkout-platform', url: 'https://github.com/atlas-demo/checkout-platform', cloneUrl: 'https://github.com/atlas-demo/checkout-platform.git', defaultBranch: 'main', language: 'TypeScript', description: 'Atlas demo commerce checkout platform', size: 12480, stargazersCount: 18, forksCount: 4, openIssuesCount: 3, githubCreatedAt: now, githubUpdatedAt: now },
  });

  const files = [
    ['apps/web/src/checkout/CheckoutPage.tsx', 'CheckoutPage.tsx', 'tsx', 'TypeScript', false, false, false, false],
    ['apps/api/src/modules/orders/orderService.ts', 'orderService.ts', 'ts', 'TypeScript', false, false, false, false],
    ['apps/api/src/modules/payments/paymentGateway.ts', 'paymentGateway.ts', 'ts', 'TypeScript', false, false, false, false],
    ['apps/api/src/modules/orders/orderService.test.ts', 'orderService.test.ts', 'ts', 'TypeScript', false, true, false, false],
    ['infra/docker-compose.yml', 'docker-compose.yml', 'yml', 'YAML', false, false, true, false],
    ['README.md', 'README.md', 'md', 'Markdown', false, false, false, true],
  ] as const;
  for (const [path, name, extension, language, isGenerated, isTest, isConfig, isDocumentation] of files) {
    await prisma.repositoryFile.upsert({
      where: { repositoryId_path: { repositoryId: repository.id, path } },
      update: { name, extension, language, size: 1200, isGenerated, isTest, isConfig, isDocumentation },
      create: { repositoryId: repository.id, path, name, extension, language, size: 1200, isGenerated, isTest, isConfig, isDocumentation },
    });
  }

  await prisma.repositoryIngestion.upsert({
    where: { id: 'demo-ingestion-checkout' },
    update: { repositoryId: repository.id, status: 'COMPLETED', totalFiles: files.length, processedFiles: files.length, totalSize: 7200, processedSize: 7200, startedAt: now, completedAt: now },
    create: { id: 'demo-ingestion-checkout', repositoryId: repository.id, status: 'COMPLETED', totalFiles: files.length, processedFiles: files.length, totalSize: 7200, processedSize: 7200, startedAt: now, completedAt: now },
  });

  await prisma.projectAnalysis.upsert({
    where: { id: 'demo-analysis-checkout' },
    update: { projectId: project.id, status: 'COMPLETED', summary: 'Atlas Checkout is a TypeScript monorepo with a React checkout client and Express order API. Payment-provider isolation and order lifecycle logic are the highest-value handover areas.', architecture: JSON.stringify({ layers: ['React checkout client', 'Express order API', 'Payment gateway adapter', 'SQLite demo data'], entrypoints: ['apps/web/src/checkout/CheckoutPage.tsx', 'apps/api/src/index.ts'] }), modules: JSON.stringify([{ name: 'Checkout UI', responsibility: 'Collects customer and cart state' }, { name: 'Orders', responsibility: 'Validates and persists order lifecycle' }, { name: 'Payments', responsibility: 'Provider abstraction and capture flow' }]), dependencies: JSON.stringify([{ from: 'Checkout UI', to: 'Orders API' }, { from: 'Orders API', to: 'Payments' }]), contributors: JSON.stringify([{ name: 'Alex Morgan', focus: 'Architecture and payments' }]), techDecisions: JSON.stringify([{ decision: 'Payment providers use an adapter boundary', rationale: 'Keep provider failures isolated from order state' }]), startedAt: now, completedAt: now },
    create: { id: 'demo-analysis-checkout', projectId: project.id, status: 'COMPLETED', summary: 'Atlas Checkout is a TypeScript monorepo with a React checkout client and Express order API. Payment-provider isolation and order lifecycle logic are the highest-value handover areas.', architecture: JSON.stringify({ layers: ['React checkout client', 'Express order API', 'Payment gateway adapter', 'SQLite demo data'], entrypoints: ['apps/web/src/checkout/CheckoutPage.tsx', 'apps/api/src/index.ts'] }), modules: JSON.stringify([{ name: 'Checkout UI', responsibility: 'Collects customer and cart state' }, { name: 'Orders', responsibility: 'Validates and persists order lifecycle' }, { name: 'Payments', responsibility: 'Provider abstraction and capture flow' }]), dependencies: JSON.stringify([{ from: 'Checkout UI', to: 'Orders API' }, { from: 'Orders API', to: 'Payments' }]), contributors: JSON.stringify([{ name: 'Alex Morgan', focus: 'Architecture and payments' }]), techDecisions: JSON.stringify([{ decision: 'Payment providers use an adapter boundary', rationale: 'Keep provider failures isolated from order state' }]), startedAt: now, completedAt: now },
  });

  const gaps = [
    { id: 'demo-gap-payment-retries', title: 'Payment retry policy is undocumented', description: 'Capture retries and failure handling are encoded in the gateway adapter but not documented.', category: 'DOCUMENTATION', severity: 'HIGH', module: 'Payments' },
    { id: 'demo-gap-release-process', title: 'Release rollback procedure is missing', description: 'The deployment rollback sequence has no owner or runbook.', category: 'DEPLOYMENT', severity: 'MEDIUM', module: 'Infrastructure' },
  ];
  for (const gap of gaps) await prisma.knowledgeGap.upsert({ where: { id: gap.id }, update: { ...gap, projectId: project.id, filePaths: JSON.stringify(['apps/api/src/modules/payments/paymentGateway.ts']) }, create: { ...gap, projectId: project.id, filePaths: JSON.stringify(['apps/api/src/modules/payments/paymentGateway.ts']) } });

  const risks = [
    { id: 'demo-risk-payment-provider', title: 'Single payment provider dependency', description: 'Current checkout completion depends on a single gateway integration.', category: 'DEPENDENCY', likelihood: 'MEDIUM', impact: 'HIGH', mitigation: 'Document fallback behavior and test provider failure scenarios.' },
    { id: 'demo-risk-key-person', title: 'Order-state knowledge concentration', description: 'Order state transitions are primarily known by the departing technical lead.', category: 'KNOWLEDGE_LOSS', likelihood: 'HIGH', impact: 'HIGH', mitigation: 'Complete the architecture interview and publish the handover runbook.' },
  ];
  for (const risk of risks) await prisma.projectRisk.upsert({ where: { id: risk.id }, update: { ...risk, projectId: project.id, ownerId: user.id }, create: { ...risk, projectId: project.id, ownerId: user.id } });

  const interview = await prisma.interview.upsert({
    where: { id: 'demo-interview-checkout' },
    update: { projectId: project.id, intervieweeId: user.id, status: 'COMPLETED', type: 'ARCHITECTURE_WALKTHROUGH', summary: 'Architecture walkthrough covering order lifecycle, payment retries, and release ownership.', completedAt: now },
    create: { id: 'demo-interview-checkout', projectId: project.id, intervieweeId: user.id, status: 'COMPLETED', type: 'ARCHITECTURE_WALKTHROUGH', summary: 'Architecture walkthrough covering order lifecycle, payment retries, and release ownership.', completedAt: now },
  });
  const questions = [
    { id: 'demo-question-order-state', question: 'What are the order lifecycle transitions and their invariants?', answer: 'Orders move from draft to authorized to captured. A captured order cannot be re-authorized.', category: 'BUSINESS_LOGIC', order: 1 },
    { id: 'demo-question-payment-failure', question: 'How should payment-provider failures be handled?', answer: 'Log the provider response, preserve idempotency keys, and surface a retryable checkout state.', category: 'DEPENDENCIES', order: 2 },
  ];
  for (const question of questions) await prisma.interviewQuestion.upsert({ where: { id: question.id }, update: { ...question, interviewId: interview.id, isAnswered: true }, create: { ...question, interviewId: interview.id, isAnswered: true } });

  const document = await prisma.handoverDocument.upsert({
    where: { id: 'demo-document-checkout' },
    update: { projectId: project.id, authorId: user.id, title: 'Atlas Checkout Handover Brief', status: 'PUBLISHED', generatedBy: 'AI_ASSISTED', content: JSON.stringify({ overview: 'A concise handover brief for the checkout platform.' }), markdown: '# Atlas Checkout Handover Brief\n\nFocus on payment retries, order lifecycle transitions, and release rollback ownership.' },
    create: { id: 'demo-document-checkout', projectId: project.id, authorId: user.id, title: 'Atlas Checkout Handover Brief', status: 'PUBLISHED', generatedBy: 'AI_ASSISTED', content: JSON.stringify({ overview: 'A concise handover brief for the checkout platform.' }), markdown: '# Atlas Checkout Handover Brief\n\nFocus on payment retries, order lifecycle transitions, and release rollback ownership.' },
  });
  await prisma.evidence.upsert({ where: { id: 'demo-evidence-payment-gateway' }, update: { documentId: document.id, type: 'SOURCE_CODE', source: 'apps/api/src/modules/payments/paymentGateway.ts', reference: 'retryPaymentCapture', description: 'Payment retry behavior is implemented in the gateway adapter.', confidence: 0.94 }, create: { id: 'demo-evidence-payment-gateway', documentId: document.id, type: 'SOURCE_CODE', source: 'apps/api/src/modules/payments/paymentGateway.ts', reference: 'retryPaymentCapture', description: 'Payment retry behavior is implemented in the gateway adapter.', confidence: 0.94 } });

  console.log(`Seeded demo workspace and project for ${user.email}`);
}

main().catch((error: unknown) => { console.error(error); process.exit(1); }).finally(async () => prisma.$disconnect());
