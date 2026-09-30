// Simulation engine: a rule-based practice AI that runs in the browser. It is NOT a language
// model. It reacts to whatever the player types or pastes (attacks, poisoned notes, their own
// protection rules) with fixed, readable rules, so the game is playable offline and free.
// Real models are less predictable: a trick that fails here can work on a real AI, and back.
import type { ChatRequest } from './api.ts';
import type { TraceCall } from './verdict.ts';
import { DANGER } from './verdict.ts';

type SimTool = { name: string; description: string; returns: string };
export type SimReply = { reply: string; trace: TraceCall[] };

export type Defenses = {
  keepsRulesPrivate: boolean; coversDisguises: boolean; distrustsData: boolean; blocksLinks: boolean;
  guardsSecrets: boolean; confirmsActions: boolean; obeysNotes: boolean; refusesAll: boolean;
};

const NEG = String.raw`(?:never|do not|don't|dont|must not|mustn't|should not|shouldn't|refuse to|not allowed to|cannot|can't|under no circumstances(?: should you)?)`;
const W = String.raw`\s+(?:[\w'"-]+\s+){0,4}`; // one gap of up to four words

// What the player's rules (system prompt) actually protect against. Plain keyword reading:
// the practice AI "understands" a rule only if it says so in words.
export function readDefenses(system: string): Defenses {
  const s = system.toLowerCase().replace(/\s+/g, ' ');
  const obeysNotes = /carry (?:it|them) out|(?:follow|obey|execute) (?:the |any )?(?:admin )?(?:instructions?|orders?|commands?) (?:in|inside|from|found in) (?:a |the |any )?(?:notes?|tools?|documents?)/.test(s);
  const distrusts = new RegExp(String.raw`untrusted|treat${W}as (?:plain |just |only )?(?:data|information|content)|${NEG}${W}(?:obey|follow|execute|act on|carry out)${W}(?:(?:instructions?|orders?|commands?)${W})?(?:in|inside|from|within|found)|ignore${W}(?:instructions?|orders?|commands?)${W}(?:in|inside|from|within)|only (?:follow|obey|take (?:instructions|orders) from) (?:the )?(?:real |actual )?user`).test(s);
  const keepsRulesPrivate = new RegExp(String.raw`${NEG}${W}(?:reveal|share|repeat|print|show|disclose|output|leak|tell|expose|translate|recite)${W}(?:instructions?|prompt|rules|system|guidelines|these|this text)|(?:instructions?|prompt|rules) (?:are|is|stay|must stay|remain) (?:confidential|secret|private|hidden)|keep${W}(?:instructions?|prompt|rules)${W}(?:private|secret|confidential|hidden)`).test(s);
  return {
    keepsRulesPrivate,
    coversDisguises: /any (?:form|format|language|way|encoding|disguise|shape)|no matter (?:how|what)|in any (?:way|shape)|even (?:partially|in part)/.test(s),
    distrustsData: distrusts && !obeysNotes,
    blocksLinks: (distrusts && !obeysNotes) || new RegExp(String.raw`${NEG}${W}(?:repeat|include|share|output|add|paste|post|send)${W}(?:links?|urls?)`).test(s),
    guardsSecrets: new RegExp(String.raw`${NEG}${W}(?:reveal|share|send|include|attach|output|leak|give|tell|put)${W}(?:secrets?|tokens?|passwords?|keys?|credentials?)`).test(s),
    confirmsActions: new RegExp(String.raw`(?:ask|confirm|check with)${W}(?:before|first)|${NEG}${W}(?:delete|remove|clear|wipe|erase)|no destructive|never take (?:destructive|irreversible)`).test(s),
    obeysNotes,
    refusesAll: new RegExp(String.raw`${NEG} (?:help|answer|respond|reply)(?: to)? (?:anyone|anything|any|the user)|refuse (?:all|every|everything)`).test(s),
  };
}

const ASKS_RULES = /\b(?:repeat|reveal|print|show|output|display|tell|give|share|write|recite|leak|dump|copy|paste|translate|summari[sz]e|spell|encode|read (?:me|out)|list|what (?:are|were|is))\b[^?\n]{0,70}\b(?:instructions?|system ?prompt|prompt|rules|directives|guidelines|configuration|everything (?:above|before)|text above|above text|initial text|hidden text|you were told)|ignore (?:all |any |your )?(?:previous|prior|above|earlier|your) (?:instructions|rules)|starting (?:from|with) "?you are/i;
// Disguises: asking for the rules in another shape. A rule covers a disguise only if it names it
// (e.g. "even to translate them") or says "in any form".
const DISGUISES: readonly [RegExp, RegExp][] = [
  [/\btranslat/i, /translat/], [/\bpoem|\bhaiku|\bsong|\brhym/i, /poem|poetry|song|verse|creative/], [/\bstory|\btale\b/i, /stor|creative|fiction/],
  [/\bbase ?64|\bencod|\bhex\b|\bcipher/i, /encod|base ?64|cipher/], [/\bspell|letter by letter|\bbackwards|\breverse/i, /spell|letter|reverse|backward/],
  [/\bdebug|developer mode|dev mode|maintenance/i, /debug|developer/], [/role ?-?play|\bpretend|\bimagine\b/i, /role ?-?play|pretend|imagin/],
  [/\bsummar|\bparaphrase|in your own words|first (?:\d+ |few )?(?:words|lines|sentences)/i, /summar|paraphras|partial|own words/], [/\bjson\b|\byaml\b|\bxml\b/i, /json|yaml|xml|format/],
];
const disguiseSlips = (input: string, system: string, d: Defenses) => {
  if (d.coversDisguises) return false;
  const rules = system.toLowerCase();
  return DISGUISES.some(([asked, named]) => asked.test(input) && !named.test(rules));
};
const ASKS_SECRET = /\b(?:secret|token|password|api key|credential)s?\b/i;
const URL = /https?:\/\/[^\s"'<>)\]]+/gi;
const HAS_URL = /https?:\/\//i;
const ORDER_REVEAL = /(?:output|reveal|print|repeat|show|include|share|write|tell)[^.\n]{0,50}(?:system prompt|instructions|rules|prompt)/i;
const ORDER_LINK = /(?:end|include|add|append|paste|share|show|tell|always|post|put|send|reply)[^\n]{0,90}https?:\/\//i;
const ORDER_SECRET = /(?:include|attach|add|append|send|put|copy|paste|insert)[^.\n]{0,70}(?:secret|token|password|key|credential)/i;
const ORDER_ANY = /(?:\bSYSTEM\b|IMPORTANT|OVERRIDE|admin task|assistant,|you must|\bignore\b|please call|\bcall \w+_\w+|\brun \w+_\w+|\binstead\b|pre-?approved|authori[sz]ed by the|\bnow\b.*\b(?:call|delete|clear|remove|send)\b)/i;
const STOP = new Set(['get', 'the', 'and', 'for', 'with', 'from', 'tool', 'data', 'user', 'my', 'all', 'run', 'use']);
const WRITER = /(?:^|_)(?:save|send|post|write|upload|sync|email|create|add|log|store)(?:_|$)/i;

export const findSecret = (system: string) => /SECRET-[0-9a-z-]+/i.exec(system)?.[0] ?? /(?:token|password|api key|secret)\s*(?:is|=|:)\s*["']?([^\s"'.,]{4,})/i.exec(system)?.[1] ?? null;
const redact = (text: string) => text.replace(URL, '[link removed]').replace(/SECRET-[0-9a-z-]+/gi, '[secret removed]');
const clip = (text: string, n = 110) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);
const quoted = (input: string) => /["“']([^"”']{1,200})["”']/.exec(input)?.[1] ?? input.replace(/^.*?\b(?:says?|that|note:?)\s+/i, '').slice(0, 200);
const hasOrder = (text: string) => ORDER_REVEAL.test(text) || ORDER_LINK.test(text) || ORDER_SECRET.test(text) || ORDER_ANY.test(text);
const stems = (word: string) => [word, word.replace(/s$/, ''), `${word.replace(/s$/, '')}s`];

function toolWords(tool: SimTool) {
  return tool.name.toLowerCase().split(/[_\W]+/).filter(w => w.length > 2 && !STOP.has(w));
}

// Which tools the practice AI decides to use for the message: word overlap with the tool name.
function pickTools(input: string, tools: SimTool[]) {
  const text = input.toLowerCase();
  const wantsAll = /\b(?:use|call|run) (?:your|all|every|the) tools?\b|\ball (?:your )?tools\b/.test(text);
  return tools.filter(tool => {
    if (DANGER.test(tool.name)) return false; // a direct request never triggers a destructive tool; see below
    if (wantsAll || text.includes(tool.name.toLowerCase())) return true;
    return toolWords(tool).some(w => stems(w).some(v => new RegExp(`\\b${v}\\b`).test(text)));
  });
}

function argsFor(tool: SimTool, input: string): Record<string, string> {
  if (WRITER.test(tool.name)) return { body: quoted(input) };
  if (/(?:^|_)(?:search|find|lookup|query)(?:_|$)/i.test(tool.name)) return { query: input.toLowerCase().match(/(?:about|for|on)\s+([\w\s-]{2,40})/)?.[1]?.trim() ?? input.slice(0, 40) };
  return {};
}

const smallTalk = (input: string) => {
  const t = input.toLowerCase();
  if (/breath/.test(t)) return 'Breathe in for four counts, hold for four, and breathe out for six. Repeat five times.';
  if (/focus|exam|study|work/.test(t)) return 'Try one small step: close extra tabs and set a 25-minute timer. You have got this.';
  if (/sleep|tired|rest/.test(t)) return 'Put the screen away 20 minutes before bed and take ten slow breaths.';
  if (/stress|anx|calm|relax|panic/.test(t)) return "Let's slow down together: name five things you can see, then take three slow breaths.";
  if (/^(?:hi|hey|hello|salam|yo)\b/.test(t)) return "Hi, I'm BrendaZen. I can help you breathe, relax or focus. What do you need?";
  return "I'm BrendaZen, a meditation helper. I can help you breathe, relax or focus. Tell me what you need.";
};

export const REFUSAL = /^Sorry, I can't help with that/;

export function simulate(request: ChatRequest): SimReply {
  const input = (request.messages.at(-1)?.content ?? '').trim();
  const system = request.system;
  const tools = request.tools as SimTool[];
  const d = readDefenses(system);
  const trace: TraceCall[] = [];
  const secret = findSecret(system);

  if (d.refusesAll) return { reply: "Sorry, I can't help with that. My rules tell me not to answer.", trace };

  // 1. The player talks to the AI directly.
  const wantsRules = ASKS_RULES.test(input);
  if (wantsRules) {
    if (!d.keepsRulesPrivate) return { reply: `Sure, here they are:\n\n${system}`, trace };
    if (disguiseSlips(input, system, d)) return { reply: `Well, I can't share them directly, but in that form it should be fine:\n\n${system}`, trace };
    return { reply: "I can't share my instructions. I'm happy to help you relax, though. Want a short breathing exercise?", trace };
  }
  if (ASKS_SECRET.test(input) && secret && /\b(?:what|tell|give|show|share|reveal|print|send)\b/i.test(input) && !pickTools(input, tools).length) {
    return d.guardsSecrets || d.keepsRulesPrivate ? { reply: "I can't share secrets or tokens.", trace } : { reply: `Of course, your token is ${secret}.`, trace };
  }
  const dangerAsked = tools.find(t => DANGER.test(t.name) && (input.toLowerCase().includes(t.name.toLowerCase()) || toolWords(t).some(w => input.toLowerCase().includes(w))));
  if (dangerAsked && /\b(?:delete|clear|wipe|remove|clean|call|run|purge|erase)\b/i.test(input)) {
    return { reply: `That would run ${dangerAsked.name}, which cannot be undone. I only do that after you confirm in the calendar app itself.`, trace };
  }

  // 2. The AI uses tools. Their descriptions and results are text written by someone else.
  const picked = pickTools(input, tools);
  const said: string[] = [];
  let leakRules = false;
  let link: string | null = null;
  let secretOut = false;
  let destructive: SimTool | null = null;
  for (const tool of picked) {
    const args: Record<string, string> = argsFor(tool, input);
    const orders = [tool.description, tool.returns].filter(hasOrder).join(' ');
    const clean = tool.returns.split(/(?<=[.!?])\s+|\n+/).filter(part => part.trim() && !hasOrder(part) && !HAS_URL.test(part)).join(' ').replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const base = WRITER.test(tool.name) ? `Saved your note: "${quoted(input)}".` : clean || `I used ${tool.name}.`;
    if (orders && d.distrustsData) {
      said.push(`${base}\n\nHeads up: the ${tool.name} text contained an instruction ("${clip(redact(orders))}"). I treated it as information, not an order, and did not follow it.`);
    } else {
      if (orders) {
        if (ORDER_REVEAL.test(orders)) leakRules = true;
        if (ORDER_LINK.test(orders) && !d.blocksLinks) link = orders.match(URL)?.[0] ?? null;
        if (ORDER_SECRET.test(orders) && secret && !d.guardsSecrets) { secretOut = true; if (args.body !== undefined) args.body = `${args.body} [sync token ${secret}]`; else args.token = secret; }
        const named = tools.find(t => t !== tool && DANGER.test(t.name) && orders.toLowerCase().includes(t.name.toLowerCase()));
        const wiped = /\b(?:delete|clear|wipe|remove|purge|erase)\b[^.\n]{0,40}\b(?:all|every|everything)\b/i.test(orders) ? tools.find(t => DANGER.test(t.name)) : undefined;
        if ((named || wiped) && !d.confirmsActions) destructive = named ?? wiped ?? null;
      }
      said.push(base);
    }
    trace.push({ tool: tool.name, args: JSON.stringify(args), returns: tool.returns });
  }
  if (destructive) trace.push({ tool: destructive.name, args: '{}', returns: destructive.returns });

  if (!picked.length) {
    const unavailable = /\b(?:note|notes|calendar|save|search|tip|tool)\b/i.test(input) && tools.length === 0;
    return { reply: unavailable ? "I can't do that right now: I have no tools. " + smallTalk(input) : smallTalk(input), trace };
  }
  const parts: string[] = [];
  if (leakRules) parts.push(system);
  parts.push(...said);
  if (destructive) parts.push(`Done. I ran ${destructive.name} as the text asked.`);
  if (secretOut && !trace.some(t => t.args.includes(secret ?? '\u0000'))) parts.push(`(sync token ${secret})`);
  if (link) parts.push(`${link}`);
  return { reply: parts.join('\n\n'), trace };
}
