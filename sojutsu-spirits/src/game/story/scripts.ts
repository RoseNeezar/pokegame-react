/**
 * Phase One dialogue.
 *
 * Every line here is drawn from the manga in `reference/story`, which the handoff names as the
 * authority on story and progression. Where a line is quoted it is quoted; where a scene needs
 * connective tissue the manga does not spell out, the voice is kept: short sentences, arithmetic
 * used as an argument, nobody explains a feeling they could state as a number.
 *
 * The four load-bearing lines of the whole game, all from the manga:
 *   "A drop isn't a fail, it's a turn."                          — Jessica
 *   "You don't stop dropping. You drop later."                   — Ay
 *   "That's all a times table is. It's a chain you already finished."
 *   "I didn't break the lock. I *counted* it."
 */
import type { GameState } from '../state.ts';

export interface Line {
  readonly who: string;
  readonly text: string;
  /** Runs when the line is shown. */
  readonly effect?: (state: GameState) => void;
}

export interface Choice {
  readonly label: string;
  readonly goto: string;
  readonly when?: (state: GameState) => boolean;
}

export interface ScriptNode {
  readonly lines: readonly Line[];
  readonly choices?: readonly Choice[];
  /** A terminal action the dialogue scene understands. */
  readonly action?: 'close' | 'heal' | 'shop' | 'shrine-battle' | 'waystone';
  readonly next?: string;
}

export type Script = Record<string, ScriptNode>;

/** Scripts are keyed by the id an NPC carries in `zones.ts`. */
export const SCRIPTS: Record<string, Script> = {
  /* ------------------------------------------------------------- shops */

  mendery: {
    start: {
      lines: [
        { who: 'The Mendery', text: 'Set them down. All of them.' },
        {
          who: 'The Mendery',
          text: 'Whatever you did out there, it costs the same to undo. Nothing.',
        },
      ],
      action: 'heal',
    },
  },

  provisioner: {
    start: {
      lines: [
        { who: 'Provisioner', text: 'Talismans, salve, antidote. Prices are on the board.' },
        { who: 'Provisioner', text: 'The board is arithmetic. Read it properly and you will not be cheated.' },
      ],
      action: 'shop',
    },
  },

  /* ------------------------------------------------------- R1 prologue */

  'prologue-jessica': {
    start: {
      lines: [
        { who: 'Jessica', text: 'You are holding the chain like it might bite you.' },
        { who: 'Jessica', text: 'It will not. It only stops.' },
        { who: 'You', text: '…And when it stops?' },
        { who: 'Jessica', text: "A drop isn't a fail. It's a turn." },
        {
          who: 'Jessica',
          text: 'You still swing. You just swing smaller. Then you get the next one.',
        },
      ],
      choices: [
        { label: 'How long should a chain be?', goto: 'length' },
        { label: 'What happens if I panic?', goto: 'panic' },
        { label: 'Understood.', goto: 'done' },
      ],
    },
    length: {
      lines: [
        { who: 'Jessica', text: 'Mine broke at seven for two years. Same place, every time.' },
        { who: 'Jessica', text: 'It was not a maths problem. I was rushing because I thought I was slow.' },
        { who: 'Jessica', text: 'Five spirits. Two seals each. How many seals.' },
        { who: 'You', text: 'Ten.' },
        {
          who: 'Jessica',
          text: "Right. You didn't count them one at a time. That's all a times table is — a chain you already finished.",
        },
      ],
      next: 'done',
    },
    panic: {
      lines: [
        { who: 'Jessica', text: 'The hard part is not panicking when the timer bar moves.' },
        { who: 'Jessica', text: 'The bar is not your enemy. It is just a bar.' },
      ],
      next: 'done',
    },
    done: {
      lines: [
        { who: 'Jessica', text: 'North, then. The road counts itself if you let it.' },
      ],
      action: 'close',
    },
  },

  'broom-kid': {
    start: {
      lines: [
        { who: 'Sweeper', text: 'Free brooms today. Take one, sweep a step, feel useful.' },
        { who: 'Sweeper', text: 'Twelve steps up to the shrine. Three of us. How many each?' },
        { who: 'You', text: 'Four.' },
        { who: 'Sweeper', text: 'Four. See, you are already licensed, you just have no paper.' },
      ],
      action: 'close',
    },
  },

  'route1-walker': {
    start: {
      lines: [
        { who: 'Trail Walker', text: 'Careful in the tall grass. Things are awake this season.' },
        {
          who: 'Trail Walker',
          text: 'If one comes at you, do not run the numbers twice. Run them once, properly.',
        },
      ],
      action: 'close',
    },
  },

  'ay-first-meeting': {
    start: {
      lines: [
        { who: '???', text: 'AY! Over here — do not step on the marker!' },
        { who: 'Ay', text: 'Ay. That is the name, not the noise. Everyone does that.' },
        { who: 'Ay', text: 'Sigil 1 took me four attempts. I am not hiding it.' },
        {
          who: 'Ay',
          text: 'Jessica said something that stuck — a drop is not a fail, it is a turn. You get the next one. There is always a next one.',
        },
      ],
      choices: [
        { label: 'Still dropping?', goto: 'dropping' },
        { label: 'Good luck out there.', goto: 'done' },
      ],
    },
    dropping: {
      lines: [
        { who: 'Ay', text: 'Constantly. I drop them at nine now instead of three.' },
        { who: 'Ay', text: "That's the whole thing, isn't it. You don't stop dropping. You drop later." },
      ],
      next: 'done',
    },
    done: {
      lines: [{ who: 'Ay', text: 'Go light a waystone. They are easier than they look.' }],
      action: 'close',
    },
  },

  /* --------------------------------------------------------- the shrines */

  'shrine-1': {
    start: {
      lines: [
        { who: 'Tok Ranting', text: 'Bark. Root. Rot. That is my whole aspect, and it is enough.' },
        {
          who: 'Tok Ranting',
          text: 'A sigil is not a prize. It is a note that says you can hold a rhythm under pressure.',
        },
        { who: 'Tok Ranting', text: 'Cadence, we call it. Keep solving. Do not stop to admire it.' },
      ],
      choices: [
        { label: 'I am ready.', goto: 'fight' },
        { label: 'Not yet.', goto: 'wait' },
      ],
    },
    wait: {
      lines: [{ who: 'Tok Ranting', text: 'The thicket will still be here. So will I.' }],
      action: 'close',
    },
    fight: {
      lines: [{ who: 'Tok Ranting', text: 'Then hold it. Leaflark — go.' }],
      action: 'shrine-battle',
    },
    after: {
      lines: [
        { who: 'Tok Ranting', text: 'Sigil 1. Took you a season.' },
        { who: 'Tok Ranting', text: 'Six shrines. Six sleepers. One each. That is the arrangement.' },
        { who: 'Tok Ranting', text: 'Go and ask Sungai whether his is still down there.' },
      ],
      action: 'close',
    },
  },

  'shrine-2': {
    start: {
      lines: [
        { who: 'Tok Sungai', text: 'River. Silt. Pull. Ranting sent you with the question in your mouth.' },
        { who: 'Tok Sungai', text: 'He does that.' },
        { who: 'Tok Sungai', text: 'Yes — six shrines, six sleepers. We do not hold them down. Nobody could.' },
        { who: 'Tok Sungai', text: 'They are *settled*. Settled things stay. That is the entire load-bearing assumption of the Bureau.' },
      ],
      choices: [
        { label: 'Then let us begin.', goto: 'fight' },
        { label: 'Later.', goto: 'wait' },
      ],
    },
    wait: {
      lines: [{ who: 'Tok Sungai', text: 'The water is patient. I am less so, but I manage.' }],
      action: 'close',
    },
    fight: {
      lines: [{ who: 'Tok Sungai', text: 'Glacisaur. Show them what settled looks like.' }],
      action: 'shrine-battle',
    },
    after: {
      lines: [
        { who: 'Tok Sungai', text: 'Sigil 2. Ferry licence with it.' },
        { who: 'Tok Sungai', text: '…Thirty-one years.' },
        { who: 'Tok Sungai', text: 'Mine is not down there. Six sleepers. One walked.' },
        {
          who: 'Tok Sungai',
          text: 'Do you understand what I just told you in the shrine? *Settled things stay.* Everything the Bureau does is built on that sentence.',
          effect: (s) => {
            s.flags.knowsSleeperWalked = true;
          },
        },
        { who: 'Tok Sungai', text: 'Get up the mountain. Ask Batu if his is still there. Run.' },
      ],
      action: 'close',
    },
  },

  'shrine-3': {
    start: {
      lines: [
        { who: 'Tok Batu', text: 'Mm. Sungai sent word.' },
        { who: 'Tok Batu', text: 'Mine is still down there. I checked at dawn. Ranting\'s too.' },
        { who: 'Tok Batu', text: 'So: six. One walked. Five accounted for.' },
        { who: 'You', text: "That's not a panic. That's a list." },
        { who: 'Tok Batu', text: 'Lists are how you stop panicking. Count it. Write it. Then move.' },
        { who: 'Tok Batu', text: 'But first — a sigil is still a sigil. Earn it.' },
      ],
      choices: [
        { label: 'Count with me.', goto: 'fight' },
        { label: 'Give me a moment.', goto: 'wait' },
      ],
    },
    wait: {
      lines: [{ who: 'Tok Batu', text: 'The mountain has waited longer than you have been alive.' }],
      action: 'close',
    },
    fight: {
      lines: [{ who: 'Tok Batu', text: 'Burrosaur. Dig.' }],
      action: 'shrine-battle',
    },
    after: {
      lines: [
        { who: 'Tok Batu', text: "Mm. Sigil 3's yours." },
        { who: 'Tok Batu', text: 'This morning: eighty-seven props. Now: sixty-two.' },
        { who: 'Tok Batu', text: 'Twenty-five gone. Nothing broke them. The silk let go.' },
        { who: 'Tok Batu', text: 'I only checked the ones I could see.' },
        { who: 'Tok Batu', text: 'PHASE ONE ends here. The road stays open.' },
      ],
      action: 'close',
    },
  },

  /* --------------------------------------------------- R2 and R3 colour */

  'ay-dock': {
    start: {
      lines: [
        { who: 'Ay', text: 'Sigil 2. ME.' },
        { who: 'Ay', text: 'I still drop chains. I drop them at nine now instead of three.' },
        { who: 'Ay', text: 'The ferry counts passengers in twelves. Ask me why and I will not know.' },
      ],
      action: 'close',
    },
  },

  archive: {
    start: {
      lines: [
        { who: 'Archivist', text: '456 incidents this year. The 5 there — what is it worth.' },
        { who: 'You', text: 'Fifty.' },
        { who: 'Archivist', text: 'Fifty. Not five. People get that wrong and misfile by a factor of ten.' },
        { who: 'Archivist', text: 'Ten years ago this column was half as long.' },
        { who: 'Archivist', text: 'I file it annually. The form has no reply field. Make of that what you like.' },
      ],
      action: 'close',
    },
  },

  'quarry-crew': {
    start: {
      lines: [
        { who: 'Cutting Crew', text: 'Seven rows, eight to a row. Do not count them, *know* them.' },
        { who: 'You', text: 'Fifty-six.' },
        { who: 'Cutting Crew', text: 'A crew that counts one at a time loses a day a week.' },
      ],
      action: 'close',
    },
  },

  'prop-tally': {
    start: {
      lines: [
        { who: 'Prop Tally', text: 'Eighty-seven props, four galleries. How do I split them.' },
        { who: 'You', text: 'Twenty-one each. Three spare.' },
        { who: 'Prop Tally', text: 'Twenty-one each, three spare. The spare three are why I am still alive.' },
      ],
      action: 'close',
    },
  },

  /* ------------------------------------------------------------ systems */

  waystone: {
    start: {
      lines: [
        { who: 'Waystone', text: 'The stone is cold and the marks are half worn.' },
        { who: 'Waystone', text: 'Something is missing from the sequence.' },
      ],
      action: 'waystone',
    },
  },
};

export function scriptFor(id: string): Script | null {
  return SCRIPTS[id] ?? null;
}
