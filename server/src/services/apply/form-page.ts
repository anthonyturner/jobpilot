import type { Page } from 'playwright-core';
import type { FilledField, OpenQuestion } from '../../domain/application.js';
import { decide, type FormField, type MatchContext } from './field-matcher.js';

/**
 * Reads every fillable control on the page, tagging each with data-jp-key so it
 * can be targeted later. Runs inside the page; must be self-contained.
 */
export async function readFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    /** Visible label text only: drops required markers, buttons, error messages and screen-reader-only helpers. */
    const text = (el: Element | null | undefined): string => {
      if (!el) return '';
      const clone = el.cloneNode(true) as Element;
      clone
        .querySelectorAll('button, input, select, textarea, [aria-hidden="true"], .required, [class*="error" i], [class*="hidden" i], [class*="sr-only" i], [class*="description" i], [role="alert"]')
        .forEach((n) => n.remove());
      return (clone.textContent ?? '').replace(/[✱*]/g, '').replace(/\s+/g, ' ').trim();
    };
    const LABELISH = 'label, legend, .application-label, .question-label, [class*="label" i], [class*="question-title" i]';

    const labelFor = (el: HTMLElement, exclude: Element[] = []): string => {
      const aria = el.getAttribute('aria-label');
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const t = labelledBy.split(' ').map((id) => text(document.getElementById(id))).join(' ').trim();
        if (t) return t;
      }
      if (el.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (forLabel && text(forLabel)) return text(forLabel);
      }
      const wrapping = el.closest('label');
      if (wrapping && !exclude.includes(wrapping) && text(wrapping)) return text(wrapping);
      if (aria) return aria.trim();
      let node: HTMLElement | null = el.parentElement;
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        const candidates = [...node.querySelectorAll(LABELISH)].filter((c) => !c.contains(el) && !exclude.includes(c) && text(c));
        if (candidates[0]) return text(candidates[0]);
      }
      return (el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '').trim();
    };

    const isRequired = (el: HTMLElement, label: string) =>
      (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*|✱|\(required\)/i.test(label);

    const visible = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
    };

    const fields: Array<{ key: string; kind: string; label: string; required: boolean; options: string[] }> = [];
    const seenGroups = new Set<string>();
    let n = 0;
    const controls = [...document.querySelectorAll<HTMLElement>('input, textarea, select')];

    for (const el of controls) {
      const input = el as HTMLInputElement;
      const type = (input.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password'].includes(type)) continue;
      // File inputs are usually hidden behind a styled button, so they are kept even when invisible.
      if (type !== 'file' && !visible(el)) continue;
      if (el.closest('[aria-hidden="true"], .grecaptcha-badge')) continue;

      if (type === 'radio' || (type === 'checkbox' && input.name && document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(input.name)}"]`).length > 1)) {
        const name = input.name || `unnamed-${n}`;
        if (seenGroups.has(name)) continue;
        seenGroups.add(name);
        const members = [...document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)].filter((m) => m.type === type);
        const key = `jp${n++}`;
        const optionLabels = members.map((m, i) => {
          m.setAttribute('data-jp-key', key);
          m.setAttribute('data-jp-option', String(i));
          const own = (m.id && document.querySelector(`label[for="${CSS.escape(m.id)}"]`)) || m.closest('label');
          return text(own) || m.value;
        });
        const ownLabels = members.map((m) => (m.id && document.querySelector(`label[for="${CSS.escape(m.id)}"]`)) || m.closest('label')).filter((l): l is HTMLLabelElement => !!l);
        const group = members[0]!.closest('fieldset');
        const label = (group && text(group.querySelector('legend'))) || labelFor(members[0]!, ownLabels);
        fields.push({ key, kind: type === 'radio' ? 'radio' : 'checkbox-group', label, required: members.some((m) => m.required) || isRequired(members[0]!, label), options: optionLabels });
        continue;
      }

      const key = `jp${n++}`;
      el.setAttribute('data-jp-key', key);
      let label = labelFor(el);
      if (type === 'file' && /^(attach|upload|choose|browse|select|drop|add)\b/i.test(label)) {
        // Styled upload widgets label the button ("Attach"), not the field. Use the section label and the input id.
        const generic = [...document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)];
        const section = labelFor(el, generic);
        label = `${/^(attach|upload|choose|browse)/i.test(section) ? '' : section} ${el.id} ${input.name}`.replace(/[_-]+/g, ' ').trim();
      }
      let kind: string = type;
      let options: string[] = [];
      if (el.tagName === 'SELECT') {
        kind = 'select';
        options = [...(el as HTMLSelectElement).options].filter((o) => o.value !== '' && !o.disabled).map((o) => o.text.trim());
      } else if (el.tagName === 'TEXTAREA') {
        kind = 'textarea';
      } else if (el.getAttribute('role') === 'combobox') {
        kind = 'combobox';
      } else if (!['text', 'email', 'tel', 'url', 'number', 'date', 'checkbox', 'file'].includes(type)) {
        kind = 'text';
      }
      fields.push({ key, kind, label, required: isRequired(el, label), options });
    }
    return fields;
  }) as Promise<FormField[]>;
}

export interface ApplyResult {
  filled: FilledField[];
  open: OpenQuestion[];
}

export interface Files {
  resume: string;
  coverLetter: string | null;
}

/** The options belonging to one open combobox: its aria-controls/owns list, else only visible options. */
async function optionsFor(page: Page, key: string) {
  const target = page.locator(`[data-jp-key="${key}"]`);
  const listId = (await target.getAttribute('aria-controls')) ?? (await target.getAttribute('aria-owns'));
  return listId ? page.locator(`[id="${listId}"] [role="option"]`) : page.locator('[role="option"]:visible');
}

/**
 * Custom dropdowns (React Select and friends) only render their options when opened.
 * Open each briefly, read the options, and close it again, so choices are made from
 * the real list instead of typed guesses.
 */
async function readComboboxOptions(page: Page, key: string): Promise<string[]> {
  const target = page.locator(`[data-jp-key="${key}"]`);
  try {
    await target.click({ timeout: 3000 });
    const options = await optionsFor(page, key);
    await options.first().waitFor({ timeout: 2000 });
    const texts = (await options.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await page.keyboard.press('Escape');
    return [...new Set(texts)].slice(0, 300);
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined);
    return [];
  }
}

/** Fills the fields it has confident answers for; returns what it filled and what still needs the owner. */
export async function fillFields(page: Page, fields: FormField[], ctx: MatchContext, files: Files): Promise<ApplyResult> {
  const filled: FilledField[] = [];
  const open: OpenQuestion[] = [];
  for (const field of fields) {
    if (field.kind === 'combobox' && field.options.length === 0) {
      const options = await readComboboxOptions(page, field.key);
      // With real options, a combobox behaves exactly like a select.
      if (options.length) Object.assign(field, { options, kind: 'combobox-select' as const });
    }
  }
  const ask = (f: FormField) =>
    open.push({ key: f.key, label: f.label, required: f.required, kind: f.kind === 'checkbox-group' ? 'checkbox' : f.kind === 'combobox-select' ? 'select' : f.kind === 'email' || f.kind === 'tel' || f.kind === 'url' || f.kind === 'number' || f.kind === 'date' ? 'text' : f.kind, options: f.options });

  for (const field of fields) {
    const decision = decide(field, ctx);
    const target = page.locator(`[data-jp-key="${field.key}"]`);
    try {
      switch (decision.type) {
        case 'skip':
          break;
        case 'ask':
          ask(field);
          break;
        case 'file': {
          const path = decision.file === 'resume' ? files.resume : files.coverLetter;
          if (!path) {
            if (field.required) ask(field);
            break;
          }
          await target.first().setInputFiles(path);
          filled.push({ label: field.label, value: path.split(/[\\/]/).pop()!, source: decision.source });
          break;
        }
        case 'check':
          await target.first().setChecked(decision.value);
          filled.push({ label: field.label, value: decision.value ? 'Checked' : 'Unchecked', source: decision.source });
          break;
        case 'value':
          await applyValue(page, field, decision.value);
          filled.push({ label: field.label, value: decision.value.length > 120 ? `${decision.value.slice(0, 117)}…` : decision.value, source: decision.source });
          break;
      }
    } catch {
      // A control we could not operate is handed to the owner rather than silently skipped.
      if (field.required) ask(field);
    }
  }
  return { filled, open };
}

async function applyValue(page: Page, field: FormField, value: string): Promise<void> {
  const target = page.locator(`[data-jp-key="${field.key}"]`);
  switch (field.kind) {
    case 'select':
      await target.selectOption({ label: value });
      return;
    case 'radio':
    case 'checkbox-group': {
      const wanted = value.split(/\s*,\s*/);
      for (const [i, option] of field.options.entries()) {
        if (wanted.includes(option)) await page.locator(`[data-jp-key="${field.key}"][data-jp-option="${i}"]`).check({ force: true });
      }
      return;
    }
    case 'combobox-select': {
      await target.click();
      await target.fill(value);
      const option = (await optionsFor(page, field.key)).filter({ hasText: value }).first();
      if (await option.count()) await option.click();
      else await page.keyboard.press('Enter');
      return;
    }
    case 'combobox':
      await target.click();
      await target.fill(value);
      await page.keyboard.press('Enter');
      return;
    default:
      await target.fill(value);
  }
}

/** Reasons the automation must stop and hand over to the owner. */
export async function findBlockers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const blockers: string[] = [];
    const visibleBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 60 && getComputedStyle(el).visibility !== 'hidden';
    };
    const captcha = [...document.querySelectorAll('iframe')].some(
      (f) => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(f.src) && !f.closest('.grecaptcha-badge') && visibleBox(f),
    );
    // Invisible CAPTCHAs (loaded on most ATS pages) are fine; only a visible challenge stops us.
    const widget = [...document.querySelectorAll('.h-captcha, .cf-turnstile, .g-recaptcha')].some((w) => visibleBox(w) && !w.closest('.grecaptcha-badge'));
    if (captcha || widget) blockers.push('A CAPTCHA is showing. Finish this one in the browser yourself.');
    const password = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].some((p) => p.offsetParent !== null);
    if (password) blockers.push('The site wants you to sign in. JobPilot never signs in for you.');
    return blockers;
  });
}
