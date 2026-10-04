import { createInterface } from 'node:readline/promises';

export function parseSelection(answer, choices, defaults) {
  if (!answer.trim()) return defaults;
  const tokens = answer.toLowerCase().trim().split(/[\s,]+/);
  if (tokens.length === 1 && tokens[0] === 'all') return choices.map(choice => choice.id);
  const ids = tokens.map(token => /^\d+$/.test(token) ? choices[Number(token) - 1]?.id : choices.find(choice => choice.id === token)?.id);
  if (ids.some(id => !id)) throw new Error('Choose the listed numbers or IDs, separated by commas.');
  return [...new Set(ids)];
}

export async function chooseSetup(choices, defaults, title) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Closing stdin is cancellation, never implicit approval of the defaults.
  try {
    console.log('\n' + title);
    choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice.name} (${choice.id})${defaults.includes(choice.id) ? '  [selected]' : ''}`));
    while (true) {
      const answer = await rl.question(`Choose numbers or IDs, "all", or Enter for ${defaults.join(', ')}: `);
      try { return parseSelection(answer, choices, defaults); }
      catch (error) { console.log(error.message); }
    }
  } finally { rl.close(); }
}
