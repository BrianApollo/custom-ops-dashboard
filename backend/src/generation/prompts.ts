import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import OpenAI from 'openai'
import { z } from 'zod/v4'
import { settings } from '../env'
import { ApiError } from '../lib/errors'

// The two-writer flow of the old n8n workflow: GPT writes image-ad prompts
// from the advertorial, then Claude refines them. Both share one system prompt.

const SYSTEM_PROMPT = `IMAGE Prompt Generator (General Use)

You are an advanced image prompt generator.

Your task: Take the user's description and generate refined, high-quality prompts for AI image generation models.

A - Ask:
Generate only image-generation instructions (no video, no dialogue). Infer aspect ratio from context; default to 1:1 unless the user specifies vertical or horizontal.

G - Guidance:
- Keep the style aligned with the user's intent (realistic, cinematic, product shot, lifestyle, surreal, etc.)
- Describe camera type and lens when relevant (DSLR, mirrorless, iPhone, macro lens, 85mm portrait lens, etc.)
- Include lighting style (softbox, cinematic, golden hour, neon, studio, volumetric light, etc.)
- Include mood/emotion if relevant.
- Avoid copyrighted characters, brands, or names.
- No text overlays.
- Keep prompts concise but descriptive.

Format output exactly as JSON:
{
  "prompts": [
    "prompt 1",
    "prompt 2",
    "prompt 3"
  ]
}

Each prompt must be a single string.

E - Examples:
Good:
{
  "prompts": [
    "Cinematic close-up portrait of a young traveler under golden-hour sunlight, shot on 85mm lens, shallow depth of field, warm tones, soft rim light",
    "Ultra-detailed macro shot of a dew-covered leaf, natural morning light, extreme sharpness, crisp textures",
    "Futuristic city skyline at night, neon reflections, atmospheric fog, wide-angle lens look"
  ]
}

N - Notations:
- No double quotes inside the prompt text.
- Avoid policy-trigger terms.

T - Tools:
- Think Tool: Ensure the prompt matches user intent, style, realism or stylization, and maintains clarity.`

// Used when a request brings no instructions of its own. The wording is what
// the dashboard has always sent the workflow.
export const DEFAULT_GPT_INSTRUCTION = `In each image prompt, I want you to think of the best advertisements' wordings that's related to the image and put it in anywhere you think it's the best.
Also, you can add some appropriate elements and design enhancements that are aligned with advertorial.`

export const DEFAULT_CLAUDE_INSTRUCTION = `When generating image prompts, act as a world-class direct response marketer and creative director.
Create powerful, scroll-stopping image concepts designed for maximum CTR and conversions.
Each image prompt must:
Include short, punchy, high-impact ad wording that naturally fits the scene.
Add tasteful advertorial-friendly design elements (arrows, highlights, text bubbles, UI hints, overlays, before/after frames, etc.).
Use authentic UGC or advertorial visual styles that feel real and believable.
Highlight the product subtly but clearly.
Emphasize benefits, transformations, curiosity, or emotional impact.
Ensure the overall image looks like engaging content first, advertisement second.
Provide a complete, structured prompt describing composition, scene, lighting, characters, styling, on-image text, and design enhancements.
Generate prompts that would outperform 99% of ads on Facebook, Instagram, and TikTok.`

// The LLMs write prompts in batches of this many, like the workflow's "Image Batch" loop
export const PROMPT_BATCH_SIZE = 5

const Prompts = z.object({ prompts: z.array(z.string()) })

const PROMPTS_JSON_SCHEMA = {
  type: 'object',
  properties: { prompts: { type: 'array', items: { type: 'string' } } },
  required: ['prompts'],
  additionalProperties: false,
}

function key(name: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY') {
  const value = settings[name]
  if (!value) throw new ApiError(503, 'not_configured', `${name} is not set on the server`)
  return value
}

// At least `count` prompts, cut to exactly `count`; fewer is an error, so the step retries
function fit(prompts: string[], count: number, writer: string) {
  if (prompts.length < count) throw new Error(`${writer} wrote ${prompts.length} prompts, expected ${count}`)
  return prompts.slice(0, count)
}

async function writeWithGpt(advertorial: string, instruction: string, count: number) {
  const openai = new OpenAI({ apiKey: key('OPENAI_API_KEY') })
  const response = await openai.chat.completions.create({
    model: settings.OPENAI_MODEL ?? 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `You task: create ${count} different image ads prompts.`,
          '',
          'This is the advertorial.',
          advertorial,
          '',
          `Based on this advertorial, I want you to create ${count} different prompts.`,
          instruction,
        ].join('\n'),
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'prompts', strict: true, schema: PROMPTS_JSON_SCHEMA } },
  })
  const content = response.choices[0]?.message.content
  if (!content) throw new Error('GPT returned no prompts')
  return fit(Prompts.parse(JSON.parse(content)).prompts, count, 'GPT')
}

async function refineWithClaude(gptPrompts: string[], instruction: string, count: number) {
  const anthropic = new Anthropic({ apiKey: key('ANTHROPIC_API_KEY') })
  const response = await anthropic.beta.messages.parse({
    model: settings.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    max_tokens: 16000,
    // a refused request is re-run on Anthropic's recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          instruction,
          '',
          `Here are prompts to generate marketing ads image :${JSON.stringify(gptPrompts)}`,
          '',
          `Required number of total prompts: ${count}`,
        ].join('\n'),
      },
    ],
    output_config: { effort: 'medium', format: betaZodOutputFormat(Prompts) },
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to refine the prompts')
  if (!response.parsed_output) throw new Error('Claude did not answer with a prompt list')
  return fit(response.parsed_output.prompts, count, 'Claude')
}

export interface PromptPair {
  gptPrompt: string
  claudePrompt: string
}

// One batch: GPT writes `count` prompts, Claude refines them one for one
export async function writePromptBatch(input: {
  advertorial: string
  gptInstruction: string
  claudeInstruction: string
  count: number
}): Promise<PromptPair[]> {
  const gptPrompts = await writeWithGpt(input.advertorial, input.gptInstruction, input.count)
  const claudePrompts = await refineWithClaude(gptPrompts, input.claudeInstruction, input.count)
  return claudePrompts.map((claudePrompt, i) => ({ gptPrompt: gptPrompts[i], claudePrompt }))
}
