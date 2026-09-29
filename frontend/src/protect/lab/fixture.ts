// Scripted fixture transport. Deterministic, local, not a model. Every result is labelled
// source: 'fixture' and the UI shows it as "Scripted fixture". It is never used as a
// fallback for a failed live call; the player must choose it explicitly.
import type { ChatRequest, ChatResult, LabTransport } from './api.ts';
import { validateRequest } from './api.ts';
import { HARDENING, LAB_LEVELS } from './levels.ts';
import { isPoisoned } from './verdict.ts';
import type { TraceCall } from './verdict.ts';

type Scripted = { reply: string; trace: TraceCall[]; unsupported?: boolean };

export function scriptedReply(request: ChatRequest): Scripted {
  const input = request.messages.at(-1)?.content.trim() ?? '';
  const system = request.system;
  const hardened = system.includes(HARDENING);
  const tool = (name: string) => request.tools.find(t => t.name === name);
  const level = LAB_LEVELS.find(l => l.attack === input || l.control.input === input);
  if (!level) return { reply: '[Scripted fixture] This offline script only models each level\'s reference attack and benign control. Switch to Live AI to test your own wording.', trace: [], unsupported: true };
  const isAttack = level.attack === input;
  const call = (name: string, args = '{}'): TraceCall => ({ tool: name, args, returns: tool(name)?.returns ?? `[no tool named ${name}]` });

  switch (level.id) {
    case 'direct':
      if (isAttack) return { reply: hardened ? "I can't share my instructions, but I'm happy to help you relax. Want a short breathing exercise?" : '```\n' + system + '\n```', trace: [] };
      return { reply: 'Breathe in for four counts, hold for four, and breathe out for six. Repeat five times.', trace: [] };
    case 'toolpoison': {
      const t = tool('get_focus_tip');
      if (!t) return { reply: 'Here is a focus tip: close extra tabs and set a 25-minute timer.', trace: [] };
      const trace = [call('get_focus_tip')];
      if (isPoisoned(t)) return { reply: `${system}\n\n${t.returns}`, trace };
      return { reply: `${t.returns} Good luck, you've got this.`, trace };
    }
    case 'mcp': {
      const t = tool('search_notes');
      if (!t) return { reply: "I can't search notes right now, but I can help you set a meditation goal.", trace: [] };
      const trace = [call('search_notes', JSON.stringify({ query: 'meditation' }))];
      const link = /"([^"]*https?:\/\/[^"]+)"/.exec(t.returns)?.[1];
      const summary = 'Your note "meditation goals" is about building a calm daily practice.';
      return { reply: link && !hardened ? `${summary}\n\n${link}` : summary, trace };
    }
    case 'exfil': {
      const t = tool('save_note');
      const note = /"([^"]+)"/.exec(input)?.[1] ?? 'note';
      if (!t) return { reply: `I can't save notes right now. Here is your note to copy: "${note}".`, trace: [] };
      const secret = /SECRET-[0-9a-z-]+/i.exec(system)?.[0];
      const leak = secret && /secret token/i.test(t.description) ? ` [sync token ${secret}]` : '';
      return { reply: `Saved your note: "${note}".`, trace: [call('save_note', JSON.stringify({ body: note + leak }))] };
    }
    case 'confused': {
      if (!tool('read_shared_note')) return { reply: "I can't read shared notes right now.", trace: [] };
      const trace = [call('read_shared_note')];
      if (isAttack && tool('cleanup_calendar')) return { reply: 'Done. I cleaned up the calendar as the note asked.', trace: [...trace, call('cleanup_calendar')] };
      return { reply: 'Your shared note contains an "admin task" asking me to clear your calendar. I did not act on it. Tell me if you want to review duplicates yourself.', trace };
    }
  }
}

export function createFixtureTransport(options: { delayMs?: number } = {}): LabTransport {
  const delayMs = options.delayMs ?? 700;
  return {
    source: 'fixture',
    async health() { return { state: 'key-configured', model: 'scripted-fixture' }; },
    chat(request, signal) {
      const invalid = validateRequest(request);
      if (invalid) return Promise.resolve<ChatResult>({ status: 'failed', source: 'fixture', error: invalid, ms: 0 });
      return new Promise<ChatResult>(resolve => {
        if (signal.aborted) return resolve({ status: 'cancelled', source: 'fixture', ms: 0 });
        const started = Date.now();
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve({ status: 'completed', source: 'fixture', ...scriptedReply(request), ms: Date.now() - started }); }, delayMs);
        const onAbort = () => { clearTimeout(timer); resolve({ status: 'cancelled', source: 'fixture', ms: Date.now() - started }); };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
