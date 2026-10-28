import { StateGraph, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { NightlyReviewAnnotation } from './state.js';
import {
  OPTIMIZATION_SYSTEM_PROMPT,
  EXECUTIVE_SUMMARY_SYSTEM_PROMPT,
  FileAnalysisResultSchema,
} from './prompts/optimizationPrompts.js';

/**
 * Node 1: Preprocesses the scanned files.
 * Validates file contents, removes empties, and prepares inspection metadata.
 */
async function preprocessFilesNode(state) {
  const rawFiles = state.files || [];
  console.log(`[LangGraph Preprocess] Validating ${rawFiles.length} candidate files...`);

  const validFiles = rawFiles.filter(
    (f) => f && typeof f.content === 'string' && f.content.trim().length > 0
  );

  console.log(`[LangGraph Preprocess] ${validFiles.length} files approved for AI performance analysis.`);

  return {
    files: validFiles,
  };
}

/**
 * Node 2: Analyzes code files for SIMD, OpenMP, Cache, and Algorithmic optimizations.
 * Uses structured output with Zod schema validation.
 */
async function analyzeFilesNode(state) {
  const files = state.files || [];
  const modelName = process.env.OPENAI_MODEL || 'gpt-4o';
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const errorMsg = 'OPENAI_API_KEY is missing. Skipping AI code review.';
    console.error(`[LangGraph Analysis] ${errorMsg}`);
    return {
      errors: [errorMsg],
      optimizations: [],
      modifiedFiles: [],
    };
  }

  const model = new ChatOpenAI({
    modelName,
    temperature: 0.1,
    openAIApiKey: apiKey,
  });

  const structuredModel = model.withStructuredOutput(FileAnalysisResultSchema);

  const collectedProposals = [];
  const modifiedFiles = [];
  const errors = [];

  for (const file of files) {
    console.log(`[LangGraph Analysis] Analyzing ${file.path} (Keywords: ${file.detectedTargets?.join(', ') || 'General'})...`);

    try {
      const promptText = `
Target File: ${file.path}
Optimization Focus Areas: ${state.targetOptimizations?.join(', ') || 'SIMD, OpenMP, Cache Locality, Algorithmic Efficiency'}
Detected Keyword Hints: ${file.detectedTargets?.join(', ') || 'None'}

Here is the source code:
\`\`\`
${file.content}
\`\`\`

Analyze the code strictly for high-impact performance optimizations (SIMD vectorization, OpenMP multi-threading, CPU cache locality, or asymptotic complexity improvements).
If optimizations are beneficial and safe, provide the full refactored file in 'refactoredFileContent'.
`.trim();

      const result = await structuredModel.invoke([
        new SystemMessage(OPTIMIZATION_SYSTEM_PROMPT),
        new HumanMessage(promptText),
      ]);

      if (result.hasOptimizations && result.proposals && result.proposals.length > 0) {
        console.log(`[LangGraph Analysis] Found ${result.proposals.length} optimization(s) for ${file.path}`);

        // Attach file path to each proposal
        const enrichedProposals = result.proposals.map((p) => ({
          ...p,
          filePath: file.path,
        }));

        collectedProposals.push(...enrichedProposals);

        // If the LLM supplied the full refactored code, stage it for branch commit
        if (result.refactoredFileContent && result.refactoredFileContent.trim() !== file.content.trim()) {
          modifiedFiles.push({
            path: file.path,
            originalContent: file.content,
            modifiedContent: result.refactoredFileContent,
            appliedProposals: enrichedProposals,
          });
        }
      } else {
        console.log(`[LangGraph Analysis] No significant optimizations required for ${file.path}`);
      }
    } catch (err) {
      console.error(`[LangGraph Analysis] Error analyzing ${file.path}:`, err.message);
      errors.push(`Failed analyzing ${file.path}: ${err.message}`);
    }
  }

  return {
    optimizations: collectedProposals,
    modifiedFiles,
    errors,
  };
}

/**
 * Node 3: Synthesizes findings into an executive Pull Request description.
 */
async function synthesizeSummaryNode(state) {
  const modifiedFiles = state.modifiedFiles || [];
  const optimizations = state.optimizations || [];

  if (modifiedFiles.length === 0 || optimizations.length === 0) {
    console.log('[LangGraph Synthesis] No code optimizations produced. Generating standard report.');
    const emptySummary = `## 🚀 Nightly AI Performance Review
All scanned repository files were evaluated against performance targets (SIMD, OpenMP, Cache Locality, and Algorithmic Efficiency).
**No critical bottlenecks or vectorization opportunities were found requiring code changes.** The scanned files currently meet efficiency standards.`;

    return {
      reviewSummary: emptySummary,
    };
  }

  console.log(`[LangGraph Synthesis] Generating executive summary for ${optimizations.length} optimization(s)...`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      reviewSummary: 'Nightly Review completed. Please check commits for details.',
    };
  }

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || 'gpt-4o',
    temperature: 0.2,
    openAIApiKey: apiKey,
  });

  const optimizationDetails = optimizations.map((opt) => `
- **File**: \`${opt.filePath}\`
- **Category**: ${opt.category}
- **Title**: ${opt.title}
- **Description**: ${opt.description}
- **Requires Human Verification**: ${opt.requiresHumanVerification ? 'YES' : 'NO'}
- **Compiler/Runtime Flags**: ${opt.compilerFlagsNeeded || 'None'}
- **Confidence**: ${opt.confidenceScore}/10
- **Original Code Snippet**:
\`\`\`
${opt.originalSnippet}
\`\`\`
- **Optimized Replacement**:
\`\`\`
${opt.proposedSnippet}
\`\`\`
`).join('\n---\n');

  try {
    const summaryResponse = await model.invoke([
      new SystemMessage(EXECUTIVE_SUMMARY_SYSTEM_PROMPT),
      new HumanMessage(`
Please write an authoritative, production-grade Pull Request description in GitHub Markdown for the following nightly review optimizations:

Target Files Modified: ${modifiedFiles.map((f) => f.path).join(', ')}

Optimizations Applied:
${optimizationDetails}
`),
    ]);

    return {
      reviewSummary: summaryResponse.content,
    };
  } catch (err) {
    console.error('[LangGraph Synthesis] Error generating executive summary:', err.message);
    return {
      reviewSummary: `## 🚀 Nightly AI Performance Review\n\nOptimized files: ${modifiedFiles.map((f) => f.path).join(', ')}\n\n*Summary generation encountered an error: ${err.message}*`,
    };
  }
}

// Construct LangGraph StateGraph
const workflow = new StateGraph(NightlyReviewAnnotation)
  .addNode('preprocess', preprocessFilesNode)
  .addNode('analyzeFiles', analyzeFilesNode)
  .addNode('synthesizeSummary', synthesizeSummaryNode)
  .addEdge(START, 'preprocess')
  .addEdge('preprocess', 'analyzeFiles')
  .addEdge('analyzeFiles', 'synthesizeSummary')
  .addEdge('synthesizeSummary', END);

// Compile the executable graph
export const nightlyReviewGraph = workflow.compile();
