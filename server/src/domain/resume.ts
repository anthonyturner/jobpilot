import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

/**
 * The base resume, as structured facts. Tailoring may only select and reorder
 * these items (plus a rewritten summary that is grounding-checked), so every
 * tailored document stays traceable to something the owner actually wrote.
 */
export const ResumeSchema = z.object({
  name: text(120),
  headline: z.string().trim().max(200).default(''),
  contact: z.object({
    email: z.string().trim().max(200).default(''),
    phone: z.string().trim().max(40).default(''),
    location: z.string().trim().max(120).default(''),
  }),
  summary: z.string().trim().max(2000).default(''),
  skills: z.array(z.object({ category: text(80), items: text(600) })).max(20).default([]),
  highlights: z.object({ title: z.string().max(80), bullets: z.array(z.object({ id, text: text(600) })).max(12) }).nullable().default(null),
  experience: z
    .array(
      z.object({
        id,
        title: text(120),
        company: text(120),
        dates: z.string().trim().max(60).default(''),
        bullets: z.array(z.object({ id, text: text(600) })).max(20),
      }),
    )
    .max(30)
    .default([]),
  projects: z.array(z.object({ id, name: text(120), text: text(1200) })).max(20).default([]),
  education: z.array(z.object({ degree: text(160), school: z.string().trim().max(160).default(''), year: z.string().trim().max(20).default('') })).max(10).default([]),
  sourceFile: z.string().max(400).default(''),
  importedAt: z.string().default(''),
});
export type Resume = z.infer<typeof ResumeSchema>;

/** Every piece of text in the resume, lower-cased, for grounding checks. */
export function resumeCorpus(resume: Resume): string {
  return [
    resume.name,
    resume.headline,
    resume.summary,
    ...resume.skills.map((s) => `${s.category} ${s.items}`),
    ...(resume.highlights?.bullets.map((b) => b.text) ?? []),
    ...resume.experience.flatMap((e) => [e.title, e.company, ...e.bullets.map((b) => b.text)]),
    ...resume.projects.map((p) => `${p.name} ${p.text}`),
    ...resume.education.map((e) => `${e.degree} ${e.school}`),
  ]
    .join('\n')
    .toLowerCase();
}
