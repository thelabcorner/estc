import { parse } from 'acorn';

/**
 * Repair the small set of output patterns that are valid ECMAScript 3 but
 * have live-verified parser problems in Illustrator ExtendScript.
 *
 * Important: this pass runs only after UglifyJS has emitted ordinary ES3.
 * We therefore use an AST instead of a hand-written lexer. Strings, regexes,
 * comments, nested blocks, and nested switch statements cannot be mistaken
 * for syntax by textual scanning.
 */

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof child.type === 'string') {
          walk(child, visit);
        }
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function addInsertion(insertions, position, text) {
  if (!insertions.has(position)) insertions.set(position, []);
  insertions.get(position).push(text);
}

function switchBounds(js, node) {
  const close = node.end - 1;
  if (close < 0 || js.charAt(close) !== '}') {
    throw new Error(
      'ESTC switch repair could not prove the closing brace for a SwitchStatement; refusing to rewrite output.'
    );
  }

  const open = js.indexOf('{', node.discriminant.end);
  if (open < 0 || open >= close) {
    throw new Error(
      'ESTC switch repair could not prove the opening brace for a SwitchStatement; refusing to rewrite output.'
    );
  }

  // Acorn's first SwitchCase must begin after the actual switch-body brace.
  // This prevents a surprising brace-like token from ever being accepted as
  // the rewrite boundary if parser/output assumptions change.
  if (node.cases.length && open >= node.cases[0].start) {
    throw new Error(
      'ESTC switch repair found an inconsistent SwitchStatement range; refusing to rewrite output.'
    );
  }

  return { open, close };
}

/**
 * Illustrator's legacy parser has historically rejected some switch output
 * shapes emitted by otherwise-valid JS printers (notably terminal ASI and, in
 * file/minifier paths, empty bodies). The repair is deliberately semantic-no-op:
 *
 * - truly empty switch -> add `default:break;`
 * - switch containing only labels -> add a trailing `break;` to the final
 *   clause, preserving evaluation order of every existing case expression
 * - switch with real consequent statements -> add only the explicit terminal
 *   separator the old parser needs when the final statement/label lacks one.
 *
 * We intentionally repair conservatively even when a particular Illustrator
 * parser surface accepts the original shape; the emitted artifact should not
 * depend on that surface/version quirk.
 */
export function repairExtendScriptSwitches(input) {
  const js = String(input);
  let ast;
  try {
    ast = parse(js, {
      ecmaVersion: 3,
      sourceType: 'script',
      allowReserved: false
    });
  } catch (error) {
    throw new Error(
      'ESTC switch repair requires valid ES3 input before rewriting: ' +
      (error && error.message ? error.message : String(error))
    );
  }

  const insertions = new Map();

  walk(ast, (node) => {
    if (node.type !== 'SwitchStatement') return;

    const { open, close } = switchBounds(js, node);

    if (node.cases.length === 0) {
      // The discriminant still evaluates exactly once. default:break performs
      // no observable work for any value.
      addInsertion(insertions, open + 1, 'default:break;');
      return;
    }

    const hasRealConsequent = node.cases.some(
      (caseNode) => Array.isArray(caseNode.consequent) && caseNode.consequent.length > 0
    );

    if (!hasRealConsequent) {
      // Do not insert a leading synthetic case: doing so could change which
      // side-effectful existing case expressions are evaluated. A break in the
      // final empty clause is equivalent to naturally reaching switch end.
      addInsertion(insertions, close, 'break;');
      return;
    }

    const finalCase = node.cases[node.cases.length - 1];
    if (!finalCase.consequent.length) {
      // Earlier clauses contain real work but the terminal label is empty.
      // Give that final clause an explicit empty statement.
      addInsertion(insertions, close, ';');
      return;
    }

    const finalStatement = finalCase.consequent[finalCase.consequent.length - 1];
    const terminal = js.charAt(finalStatement.end - 1);
    if (terminal !== ';' && terminal !== '}') {
      // Only repair the ASI-sensitive terminal statement. Block statements and
      // already-terminated statements are left byte-for-byte unchanged.
      addInsertion(insertions, finalStatement.end, ';');
    }
  });

  if (!insertions.size) return js;

  const positions = [...insertions.keys()].sort((a, b) => a - b);
  const parts = [];
  let last = 0;
  for (const position of positions) {
    if (position < last || position > js.length) {
      throw new Error('ESTC switch repair produced an invalid insertion range; refusing output.');
    }
    parts.push(js.slice(last, position));
    parts.push(...insertions.get(position));
    last = position;
  }
  parts.push(js.slice(last));
  return parts.join('');
}
