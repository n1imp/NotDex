// OpenAI API Standard reference, checked 2026-11-10; this is not subscription billing.
const SOURCE = 'https://developers.openai.com/api/docs/pricing';
const CHECKED_AT = '2026-11-10';
const RATES = {
  'gpt-6.1-sol': [2, 0.1, 10, 4, 0.2, 15],
  'gpt-6.1-terra': [1, 0.05, 5, 2, 0.1, 7.5],
  'gpt-6-astra': [10, 1, 50, 20, 2, 75],
  'gpt-6-sol': [2, 0.2, 10, 4, 0.4, 15],
  'gpt-6-luna': [0.1, 0.01, 0.5, 0.2, 0.02, 0.75],
  'gpt-5.6-sol': [4, 0.4, 20, 8, 0.8, 30],
  'gpt-5.6-terra': [2, 0.2, 12, 4, 0.4, 18],
  'gpt-5.6-luna': [0.2, 0.02, 1.2, 0.4, 0.04, 1.8],
  'gpt-5.5': [5, 0.5, 30, 10, 1, 45],
  'gpt-5.4': [2.5, 0.25, 15, 5, 0.5, 22.5],
  'gpt-5.4-mini': [0.75, 0.075, 4.5],
  'gpt-5.4-nano': [0.2, 0.02, 1.25],
  'gpt-5.2': [1.75, 0.175, 14],
  'gpt-5.1': [1.25, 0.125, 10],
  'gpt-5': [1.25, 0.125, 10],
  'gpt-5-mini': [0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.005, 0.4],
  'gpt-4.1': [2, 0.5, 8],
  'gpt-4.1-mini': [0.4, 0.1, 1.6],
  'gpt-4o': [2.5, 1.25, 10],
  'gpt-4o-mini': [0.15, 0.075, 0.6],
  o3: [2, 0.5, 8]
};

function requestPrice(model, usage) {
  const rates = RATES[model];
  const { input_tokens: input, cached_input_tokens: cached, output_tokens: output } = usage;
  if (!rates || ![input, cached, output].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) return null;
  // Cache-write duration is not present in Codex usage records; do not guess its API rate.
  if (usage.cache_write_input_tokens !== undefined && usage.cache_write_input_tokens !== 0) return null;
  const selected = input > 272000 && rates.length === 6 ? rates.slice(3) : rates;
  return [input - cached, cached, output].reduce((sum, tokens, i) => sum + BigInt(tokens) * BigInt(Math.round(selected[i] * 1e6)), 0n);
}

function dollarString(picoDollars) {
  if (picoDollars === null) return null;
  const micros = (picoDollars + 500000n) / 1000000n;
  return (micros / 1000000n).toString() + '.' + (micros % 1000000n).toString().padStart(6, '0');
}

module.exports = { SOURCE, CHECKED_AT, requestPrice, dollarString };
