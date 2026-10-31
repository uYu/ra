import { random } from "../../src/game/data.ts";
/** Bootstrap complete seed-block scores; never resample correlated seats alone. */
export function seedBootstrap(
  scores: number[],
  resamples = 100000,
  seed = 1270099,
) {
  if (
    scores.length < 2 ||
    scores.some((x) => !Number.isFinite(x) || x < 0 || x > 1)
  )
    throw Error("Invalid complete seed-block scores");
  if (!Number.isInteger(resamples) || resamples < 100)
    throw Error("Invalid bootstrap count");
  const rng = random(seed),
    values: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let score = 0;
    for (let i = 0; i < scores.length; i++)
      score += scores[Math.floor(rng() * scores.length)];
    values.push(score / scores.length);
  }
  values.sort((a, b) => a - b);
  return {
    lower: values[Math.floor(0.025 * (values.length - 1))],
    upper: values[Math.floor(0.975 * (values.length - 1))],
    estimate: scores.reduce((a, b) => a + b, 0) / scores.length,
    resamples,
    seed,
  };
}
