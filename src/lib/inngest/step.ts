/**
 * The narrow subset of Inngest's `step` that the pure, exported flow bodies
 * depend on. Sharing it lets integration tests pass a pass-through fake
 * (`step.run(name, fn) → fn()`) without spinning up an Inngest runtime.
 *
 * The per-photo workers (`index-photo-faces.ts`, `detect-photo-bibs.ts`)
 * still declare their own byte-identical `PhotoUploadStep` / `BibDetectStep`;
 * those predate this shared type and can migrate here later.
 */
export interface InngestStepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
