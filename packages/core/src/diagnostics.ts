/**
 * What an error still says once the prose has been stripped out of it.
 *
 * Volt's messages are long on purpose — they name the mistake, the thing that
 * made it and the way out — and `__VOLT_DEV__` exists so a production bundle
 * carries none of that text. Read literally, that leaves production with
 * nothing: half the throw sites in this package shipped a truncated phrase
 * (`[volt] not a component`) and the other half shipped the whole paragraph,
 * because the throw is behaviour a correct program depends on and the guard
 * that removes text also removes the `throw`.
 *
 * So the flag is split in two, and this module is where the seam is:
 *
 *   - **`__VOLT_DEV__` gates the words.** Every message below is written as
 *     `__VOLT_DEV__ && '…'`, which a production build folds to `false` and a
 *     minifier then deletes along with the string literal. Nothing else about
 *     the failure changes: the same call throws, from the same line, with the
 *     same type.
 *   - **`__VOLT_DIAGNOSTICS__` gates the structure**, and is *on* in a
 *     production build. The code, the identity of what failed and the place to
 *     look the full text up survive the strip, because they are what makes a
 *     production stack trace worth reading. A build that wants neither — an
 *     embedded target counting every byte — defines it `false` and gets a bare
 *     code.
 *
 * The constant is read through `typeof` so that a build which never heard of
 * it keeps its diagnostics rather than crashing on an undefined identifier:
 * absent means on. Defined to a literal, the whole expression folds at build
 * time and the guarded blocks go with it.
 *
 * What a production error therefore carries:
 *
 *     err.code    'V0101'                        — stable, greppable, and the
 *                                                   key the full text is under
 *     err.detail  { entry: 'renderToString' }    — which component, prop, key
 *                                                   or region this was about
 *     err.docs    'https://voltjs.dev/e/V0101'   — where the sentence lives
 *     err.message '[volt] V0101 entry=renderToString https://voltjs.dev/e/V0101'
 *
 * The message repeats the fields on purpose. A log pipeline that keeps only
 * `message` is the common case, and an error whose identity is reachable only
 * by a consumer that knows to look at `.detail` is an error most consumers
 * will not read.
 */

/**
 * Whether this build keeps the structure around an error.
 *
 * Not `__VOLT_DEV__`: this one is true in production, which is the whole
 * point. See the note above on why it is read through `typeof`.
 */
declare const __VOLT_DIAGNOSTICS__: boolean | undefined;

export const DIAGNOSTICS: boolean =
  typeof __VOLT_DIAGNOSTICS__ === 'boolean' ? __VOLT_DIAGNOSTICS__ : true;

/** Where the full text of a code lives, for a build that is not carrying it. */
export const DOCS = 'https://voltjs.dev/e/';

/**
 * What failed, named.
 *
 * Short keys, and values that are already identities rather than values: a
 * component's selector, a prop's name, a boundary's id. Never the data itself
 * — a production error is read by whoever operates the application, and the
 * row that failed is not theirs to see.
 */
export type Detail = Readonly<Record<string, string | number>>;

const NO_DETAIL: Detail = {};

/** The text, in a build that kept it. `false` is what the strip leaves. */
export type Prose = string | false | undefined;

function named(detail: Detail): string {
  let text = '';
  for (const key of Object.keys(detail)) text += `${key}=${String(detail[key])} `;
  return text;
}

/**
 * An error that says what it was about in every build.
 *
 * `code` and `detail` are the two things a report needs and a stack trace into
 * minified framework code cannot supply. They are fields rather than a parsed
 * message so that a reporter can group by code without matching on prose that
 * is only there some of the time.
 */
export class VoltError extends Error {
  /** Stable across releases, and the key the full text is filed under. */
  readonly code: string;
  /** The component, prop, key or region this was about. */
  readonly detail: Detail;
  /** Where to read the sentence this build is not carrying. */
  readonly docs: string;

  constructor(code: string, detail: Detail, prose: Prose) {
    // `prose ||` rather than a second flag: the strip turns the argument into
    // `false`, and the identity is what is left to say.
    super(
      DIAGNOSTICS
        ? `[volt] ${code} ${prose || named(detail) + DOCS + code}`
        : `[volt] ${code}`,
    );
    this.name = 'VoltError';
    this.code = code;
    this.detail = DIAGNOSTICS ? detail : NO_DETAIL;
    this.docs = DIAGNOSTICS ? DOCS + code : '';
  }
}

/**
 * Build one.
 *
 * A function rather than the constructor at each site so that `detail` can be
 * left out, and so the strip has one shape to fold everywhere.
 */
export function voltError(code: string, detail?: Detail, prose?: Prose): VoltError {
  return new VoltError(code, detail ?? NO_DETAIL, prose);
}

/**
 * The three render entry points share one refusal, so they share one sentence.
 *
 * Written once rather than three times because it was three near-identical
 * paragraphs, which is three times the bytes for a build that keeps them and
 * three places for the wording to drift apart.
 */
export function needsServerBuild(entry: string): VoltError {
  return voltError(
    'V0101',
    { entry },
    __VOLT_DEV__ &&
      `${entry} needs a server build. Templates are compiled for one side or the other, ` +
        'and a client build emits render functions that clone markup rather than write it ' +
        '— @voltdev/vite-plugin decides this per environment.',
  );
}

/**
 * Raw text — `<script>`, `<style>`, and a value written into either — cannot
 * be escaped, so the only answer is to refuse it. Two call sites, one for a
 * value and one for a stylesheet, and one sentence between them.
 */
export function endsItsElement(tag: string, what: string, fix: string): VoltError {
  return voltError(
    'V0301',
    { tag },
    __VOLT_DEV__ &&
      `${what} contains "</${tag}", which ends the element rather than appearing inside it. ` +
        `Raw text cannot be escaped — an entity there is not decoded — so ${fix}.`,
  );
}
