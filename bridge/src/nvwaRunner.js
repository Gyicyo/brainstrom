import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { piSessionManager } from './piSessionManager.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.resolve(__dirname, '../skills/nuwa-skill/SKILL.md');
const SKILL_CONTENT = readFileSync(SKILL_PATH, 'utf-8');

const ns = 'nvwaRunner';

function augmentSkillWithConfig(skillContent, { personName, context, outputDir: absOutputDir }) {
  const contextLine = context ? `Relevant context: ${context}` : 'None provided — use your best knowledge.';
  return `${skillContent}

---
## Runtime Configuration

**Assignment**: Your job right now is to distill **"${personName}"** into a structured SKILL.md.

**Context / disambiguation**: ${contextLine}

**Output directory**: ${absOutputDir}

**Output language**: All output must be in Chinese (Simplified). Write the entire pipeline and the final SKILL.md in Chinese.

**IMPORTANT — Override instructions**:
1. Ignore any references to fixed output paths. All files go to the directory above.
2. You do NOT have access to file system tools — just output text. The host code saves your outputs.
3. When generating the final SKILL.md, include full YAML frontmatter and all sections described in the framework.
`;
}

export async function runNvwa({ personName, context, outputDir, apiConfig }) {
  if (!apiConfig?.apiKey) {
    throw new Error('apiConfig.apiKey is required');
  }

  const absOutputDir = path.resolve(outputDir);
  if (!existsSync(absOutputDir)) {
    mkdirSync(absOutputDir, { recursive: true });
  }

  const augmentedSkill = augmentSkillWithConfig(SKILL_CONTENT, {
    personName,
    context: context || '',
    outputDir: absOutputDir,
  });

  const sessionId = `nvwa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  piSessionManager.createSession(sessionId, {
    agents: [{ name: 'nvwa', skillContent: augmentedSkill }],
    apiConfig,
  });

  const lang = 'Chinese';

  try {
    // Phase 1 — Research
    const researchOutput = await piSessionManager.chat(sessionId, 'nvwa',
      `Phase 1 — Research phase. Using your training knowledge, write everything significant you know about ${personName}: their background, key ideas, major works, and what makes their thinking distinctive. ${context ? `Focus on aspects related to: ${context}` : ''} Output in ${lang}.`
    );
    writeFileSync(path.join(absOutputDir, '01-research-survey.md'), researchOutput, 'utf-8');

    // Phase 2 — Framework extraction
    const extractionOutput = await piSessionManager.chat(sessionId, 'nvwa',
      `Phase 2 — Framework extraction. Analyze ${personName}'s thinking patterns. Identify core mental models, decision heuristics, and expression DNA. Apply the triple-verification: cross-domain, generativity, exclusivity. Output in ${lang}.`
    );
    writeFileSync(path.join(absOutputDir, '02-framework-extraction.md'), extractionOutput, 'utf-8');

    // Phase 3 — Generate final SKILL.md
    const rawSkillContent = await piSessionManager.chat(sessionId, 'nvwa',
      `Phase 3 — Generate the final SKILL.md file for ${personName}. Follow the Nuwa framework structure: YAML frontmatter, role-play rules, identity card, mental models, decision heuristics, expression DNA, values & anti-patterns, honest limitations, and source attribution. Return ONLY the raw SKILL.md content in a markdown code block. Output in ${lang}.`
    );

    const codeBlockMatch = rawSkillContent.match(/```(?:markdown|yaml)\n([\s\S]*?)\n```/);
    const directYamlMatch = rawSkillContent.match(/^---\n[\s\S]*?\n---/m);
    const skillFileContent = codeBlockMatch?.[1] || directYamlMatch?.[0] || rawSkillContent;

    writeFileSync(path.join(absOutputDir, 'SKILL.md'), skillFileContent, 'utf-8');

    return {
      skillContent: skillFileContent,
      outputDir: absOutputDir,
      files: ['01-research-survey.md', '02-framework-extraction.md', 'SKILL.md'],
    };
  } finally {
    piSessionManager.deleteSession(sessionId);
  }
}

export function augmentForDisplay(personName, context) {
  return augmentSkillWithConfig(SKILL_CONTENT, {
    personName,
    context: context || '',
    outputDir: '(host-managed)',
  });
}
