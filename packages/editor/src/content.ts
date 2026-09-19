/**
 * Content expressions: what a node is allowed to contain.
 *
 * A schema says `"paragraph block*"` or `"(paragraph | heading) block+"` or
 * `"text*"`, and this file turns that string into a state machine that can
 * answer three different questions with one mechanism.
 *
 * The first is "is this document legal", which a plain predicate could
 * answer. The second is "may this node go here, given what is already before
 * it" — asked once per node while a step is validated, before anything is
 * applied. The third is the one that decides the design: "what is the shortest
 * run of nodes that would make this legal". That is how a list item required
 * to hold a paragraph gets one, and how a replace that would leave a block
 * empty fills it instead of producing a document the schema forbids. A
 * predicate cannot answer it; a state machine can, by searching outward from
 * the current state for a path to a valid end.
 *
 * The expression is parsed to a syntax tree, compiled to a nondeterministic
 * automaton, and then determinised once at schema construction. Determinising
 * up front matters because the matcher is consulted on every node of every
 * validated fragment: after this, matching a child is a lookup over a short
 * edge list, with no backtracking anywhere.
 *
 * The supported grammar is deliberately smaller than a regular expression:
 * sequence, alternation with `|`, grouping with parentheses, and the `*`, `+`
 * and `?` modifiers. Counted repetition (`{2,4}`) is not supported — no schema
 * this package ships needs it, and leaving it out keeps the compiler small
 * enough to read. A name is either a node type or a group declared by node
 * types, and a group expands to an alternation of its members.
 */

import { Fragment } from './node.js';
import type { Node } from './node.js';
import type { NodeType } from './schema.js';

type Expr =
  | { kind: 'choice'; exprs: Expr[] }
  | { kind: 'seq'; exprs: Expr[] }
  | { kind: 'star'; expr: Expr }
  | { kind: 'plus'; expr: Expr }
  | { kind: 'opt'; expr: Expr }
  | { kind: 'name'; value: NodeType };

interface Edge {
  readonly term: NodeType | null;
  to: number;
}

/**
 * One state of the compiled matcher.
 *
 * `next` is the set of node types that may follow, each with the state to move
 * to. `validEnd` says whether the content may stop here — the difference
 * between `"paragraph+"` having seen one paragraph and having seen none.
 */
export class ContentMatch {
  readonly next: { type: NodeType; next: ContentMatch }[] = [];

  constructor(readonly validEnd: boolean) {}

  /** The match for a node type that accepts nothing at all. */
  static readonly empty: ContentMatch = new ContentMatch(true);

  matchType(type: NodeType): ContentMatch | null {
    for (const edge of this.next) if (edge.type === type) return edge.next;
    return null;
  }

  /**
   * Run a run of children through the machine, returning where it ends up.
   *
   * `null` means the content is illegal here, and the caller has enough
   * information to say which child broke it by matching one at a time.
   */
  matchFragment(frag: Fragment, start = 0, end = frag.childCount): ContentMatch | null {
    let match: ContentMatch | null = this;
    for (let i = start; match && i < end; i++) {
      match = match.matchType(frag.child(i).type);
    }
    return match;
  }

  /**
   * A node type that may be created here without arguments.
   *
   * Used when something must be inserted and there is no better answer — the
   * paragraph in "a list item must hold a paragraph". Text is excluded because
   * a bare text node cannot be conjured without content, and types with
   * required attributes are excluded because there is nothing to fill them
   * with.
   */
  get defaultType(): NodeType | null {
    for (const edge of this.next) {
      if (!edge.type.isText && !edge.type.hasRequiredAttrs) return edge.type;
    }
    return null;
  }

  /**
   * The shortest run of nodes that lets `after` follow this state legally.
   *
   * This is the normalisation engine. Breadth-first over the automaton, so the
   * result is the fewest nodes that work rather than the first path found —
   * for `(a b c) | d`, `d` rather than `a b c` — and among runs of the same
   * length, the one whose types come first in the expression. `toEnd`
   * additionally demands that the content be complete afterwards, which is
   * what a caller closing off a node wants and what a caller inserting into
   * the middle of one does not.
   *
   * Returns `null` when no run of default-createable nodes bridges the gap,
   * which is a legitimate answer: the caller then knows the edit is impossible
   * rather than producing something invalid.
   */
  fillBefore(after: Fragment, toEnd = false, startIndex = 0): Fragment | null {
    // Every state reached, with the types that lead to it from here, in the
    // order they were reached. Each is reached once, by the shortest run that
    // gets there, and that is also what stops a `*` from looping.
    const seen: ContentMatch[] = [this];
    const reached: { match: ContentMatch; via: NodeType[] }[] = [{ match: this, via: [] }];

    for (let i = 0; i < reached.length; i++) {
      const { match, via } = reached[i]!;
      const finished = match.matchFragment(after, startIndex);
      if (finished && (!toEnd || finished.validEnd)) {
        const filled = via.map((type) => type.createAndFill());
        if (filled.every((node): node is Node => node !== null)) return Fragment.from(filled);
        continue;
      }

      for (const { type, next } of match.next) {
        if (type.isText || type.hasRequiredAttrs || seen.includes(next)) continue;
        seen.push(next);
        reached.push({ match: next, via: [...via, type] });
      }
    }
    return null;
  }

  /**
   * Whether a run of nodes can be reached from here at all, ignoring what
   * comes between. Used to decide whether a paste is hopeless before trying to
   * find the exact filler for it.
   */
  matchFragmentOrFill(frag: Fragment): ContentMatch | null {
    const direct = this.matchFragment(frag);
    if (direct) return direct;
    const filler = this.fillBefore(frag);
    if (!filler) return null;
    const withFiller = this.matchFragment(filler);
    return withFiller ? withFiller.matchFragment(frag) : null;
  }
}

/**
 * Parse a content expression against a schema's declared types and groups.
 *
 * Called once per node type at schema construction, and never again. Errors
 * here are schema authoring errors, so they name the expression and the
 * offending token rather than trying to recover.
 */
export function parseContentExpression(
  expression: string,
  typeName: string,
  lookup: (name: string) => NodeType[],
): ContentMatch {
  const source = expression.trim();
  if (source.length === 0) return ContentMatch.empty;

  const tokens = tokenize(source, typeName);
  const stream = { tokens, pos: 0 };
  const expr = parseExpr(stream, typeName, lookup);
  if (stream.pos < tokens.length) {
    throw new SyntaxError(`Unexpected '${tokens[stream.pos]}' in content expression '${expression}' of ${typeName}`);
  }
  return determinise(buildNfa(expr));
}

function tokenize(source: string, typeName: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*(?:([\w-]+)|([|()*+?]))/y;

  let at = 0;
  while (at < source.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (!match) {
      throw new SyntaxError(`Unexpected character '${source[at]}' in content expression of ${typeName}`);
    }
    tokens.push(match[1] ?? match[2]!);
    at = pattern.lastIndex;
  }
  return tokens;
}

interface Stream {
  tokens: string[];
  pos: number;
}

function peek(stream: Stream): string | null {
  return stream.tokens[stream.pos] ?? null;
}

function eat(stream: Stream, token: string): boolean {
  if (peek(stream) === token) {
    stream.pos++;
    return true;
  }
  return false;
}

function parseExpr(stream: Stream, typeName: string, lookup: (name: string) => NodeType[]): Expr {
  const exprs: Expr[] = [parseSeq(stream, typeName, lookup)];
  while (eat(stream, '|')) exprs.push(parseSeq(stream, typeName, lookup));
  return exprs.length === 1 ? exprs[0]! : { kind: 'choice', exprs };
}

function parseSeq(stream: Stream, typeName: string, lookup: (name: string) => NodeType[]): Expr {
  const exprs: Expr[] = [];
  for (;;) {
    const token = peek(stream);
    if (token === null || token === '|' || token === ')') break;
    exprs.push(parseModified(stream, typeName, lookup));
  }
  if (exprs.length === 0) throw new SyntaxError(`Empty alternative in content expression of ${typeName}`);
  return exprs.length === 1 ? exprs[0]! : { kind: 'seq', exprs };
}

function parseModified(stream: Stream, typeName: string, lookup: (name: string) => NodeType[]): Expr {
  let expr = parseAtom(stream, typeName, lookup);
  for (;;) {
    if (eat(stream, '*')) expr = { kind: 'star', expr };
    else if (eat(stream, '+')) expr = { kind: 'plus', expr };
    else if (eat(stream, '?')) expr = { kind: 'opt', expr };
    else return expr;
  }
}

function parseAtom(stream: Stream, typeName: string, lookup: (name: string) => NodeType[]): Expr {
  if (eat(stream, '(')) {
    const inner = parseExpr(stream, typeName, lookup);
    if (!eat(stream, ')')) throw new SyntaxError(`Missing ')' in content expression of ${typeName}`);
    return inner;
  }

  const name = peek(stream);
  if (name === null || !/^[\w-]+$/.test(name)) {
    throw new SyntaxError(`Unexpected '${name ?? 'end of expression'}' in content expression of ${typeName}`);
  }
  stream.pos++;

  const types = lookup(name);
  if (types.length === 0) {
    throw new RangeError(`No node type or group named '${name}', in the content expression of ${typeName}`);
  }
  const exprs: Expr[] = types.map((value) => ({ kind: 'name', value }));
  return exprs.length === 1 ? exprs[0]! : { kind: 'choice', exprs };
}

/**
 * Thompson construction: every expression form becomes a small graph of states
 * joined by epsilon edges, and the dangling edges of one are connected to the
 * entry state of the next.
 */
function buildNfa(expr: Expr): Edge[][] {
  const nfa: Edge[][] = [[]];

  const node = (): number => nfa.push([]) - 1;
  const edge = (from: number, to = -1, term: NodeType | null = null): Edge => {
    const created: Edge = { term, to };
    nfa[from]!.push(created);
    return created;
  };
  const connect = (edges: Edge[], to: number): void => {
    for (const e of edges) e.to = to;
  };

  const compile = (current: Expr, from: number): Edge[] => {
    switch (current.kind) {
      case 'choice':
        return current.exprs.flatMap((sub) => compile(sub, from));
      case 'seq': {
        let at = from;
        for (let i = 0; ; i++) {
          const next = compile(current.exprs[i]!, at);
          if (i === current.exprs.length - 1) return next;
          at = node();
          connect(next, at);
        }
      }
      case 'star': {
        const loop = node();
        edge(from, loop);
        connect(compile(current.expr, loop), loop);
        return [edge(loop)];
      }
      case 'plus': {
        const loop = node();
        connect(compile(current.expr, from), loop);
        connect(compile(current.expr, loop), loop);
        return [edge(loop)];
      }
      case 'opt':
        return [edge(from), ...compile(current.expr, from)];
      case 'name':
        return [edge(from, -1, current.value)];
    }
  };

  connect(compile(expr, 0), node());
  return nfa;
}

/** Every state reachable from `start` without consuming a node. */
function epsilonClosure(nfa: Edge[][], start: number): number[] {
  const result: number[] = [];

  const scan = (state: number): void => {
    const edges = nfa[state]!;
    // A state whose only exit is an epsilon edge is not worth recording; it can
    // never be an end state on its own and it doubles the size of every subset.
    if (edges.length === 1 && !edges[0]!.term) return scan(edges[0]!.to);
    result.push(state);
    for (const { term, to } of edges) {
      if (!term && !result.includes(to)) scan(to);
    }
  };

  scan(start);
  return result.sort((a, b) => a - b);
}

/**
 * Subset construction. Each DFA state is a set of NFA states, keyed by the
 * sorted set so that revisiting a subset reuses the state rather than looping
 * forever on a `*`.
 */
function determinise(nfa: Edge[][]): ContentMatch {
  const labeled = new Map<string, ContentMatch>();
  const endState = nfa.length - 1;

  const explore = (states: number[]): ContentMatch => {
    const grouped: { type: NodeType; states: number[] }[] = [];

    for (const state of states) {
      for (const { term, to } of nfa[state]!) {
        if (!term) continue;
        let bucket = grouped.find((entry) => entry.type === term);
        if (!bucket) {
          bucket = { type: term, states: [] };
          grouped.push(bucket);
        }
        for (const reachable of epsilonClosure(nfa, to)) {
          if (!bucket.states.includes(reachable)) bucket.states.push(reachable);
        }
      }
    }

    const match = new ContentMatch(states.includes(endState));
    labeled.set(states.join(','), match);

    for (const { type, states: target } of grouped) {
      const sorted = target.slice().sort((a, b) => a - b);
      const key = sorted.join(',');
      match.next.push({ type, next: labeled.get(key) ?? explore(sorted) });
    }

    return match;
  };

  return explore(epsilonClosure(nfa, 0));
}

/**
 * The matcher state after a node's first `index` children.
 *
 * Recomputed rather than cached on the node: a node's content changes more
 * often than it is asked this, and a stale cache on an immutable value is a
 * contradiction waiting to be debugged.
 */
export function contentMatchAt(node: Node, index: number): ContentMatch {
  const match = node.type.contentMatch.matchFragment(node.content, 0, index);
  if (!match) {
    throw new RangeError(`Called contentMatchAt on a ${node.type.name} whose own content is invalid`);
  }
  return match;
}
