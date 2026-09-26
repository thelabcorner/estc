import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripAdobeDirectives } from './directives.mjs';
import { reservedData } from './reserved.mjs';
import { withIllustratorV2 } from './comtool-v2.mjs';

function failed(error) {
  return {
    ok: false,
    unavailable: error && error.unavailable === true,
    error: error && error.message ? error.message : String(error)
  };
}

function executeProbe(source, options = {}) {
  try {
    return withIllustratorV2({
      launch: options.launch === true,
      target: options.target || null,
      pipe: options.pipe || null,
      leaseWaitMs: options.leaseWaitMs,
      leaseTtlMs: options.leaseTtlMs
    }, (session) => {
      const value = session.eval(source, {
        timeoutMs: options.timeoutMs || 180000
      });
      return {
        ok: true,
        raw: String(value === undefined || value === null ? '' : value),
        targetId: session.targetId,
        transport: 'COM Tool V2 script.eval'
      };
    });
  } catch (error) {
    return failed(error);
  }
}

function executeFileProbe(source, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-live-parse-'));
  const file = path.join(dir, 'parse-probe.jsx');
  fs.writeFileSync(file, source, 'utf8');
  try {
    return withIllustratorV2({
      launch: options.launch === true,
      target: options.target || null,
      pipe: options.pipe || null,
      leaseWaitMs: options.leaseWaitMs,
      leaseTtlMs: options.leaseTtlMs
    }, (session) => {
      const value = session.runFile(file, {
        timeoutMs: options.timeoutMs || 180000
      });
      return {
        ok: true,
        raw: String(value === undefined || value === null ? '' : value),
        targetId: session.targetId,
        transport: 'COM Tool V2 script.runFile'
      };
    });
  } catch (error) {
    return failed(error);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export function runLiveParse(text, options = {}) {
  const body = stripAdobeDirectives(text).body;
  // Parse the complete project body inside a function expression, exactly as
  // the old DoJavaScript probe did, but never invoke that function. The outer
  // IIFE returns only host/version evidence through COM Tool V2.
  const source = [
    '(function(){',
    'void function(){',
    body,
    '};',
    'return "OK|" + app.version + "|" + $.version;',
    '}())'
  ].join('\n');

  // Use a SHA-bound temporary file rather than --expr so large accelerated
  // bundles never approach Windows' process command-line limit. The wrapper
  // still leaves the project body inside an uninvoked function: runFile
  // executes only the outer parse probe, not the artifact itself.
  const result = executeFileProbe(source, options);
  if (!result.ok) return result;
  if (!result.raw.startsWith('OK|')) {
    return {
      ok: false,
      raw: result.raw,
      error: 'Illustrator parse probe returned an unexpected result.',
      targetId: result.targetId,
      transport: result.transport
    };
  }
  const parts = result.raw.split('|');
  return {
    ok: true,
    appVersion: parts[1] || '',
    engineVersion: parts[2] || '',
    raw: result.raw,
    targetId: result.targetId,
    transport: result.transport
  };
}

export function runHostProbe(options = {}) {
  const parseCases = [
    ['constDeclaration', 'const x=1;'],
    ['e4xLiteral', 'var x=<root><a>1</a></root>;'],
    ['nestedTernaryUnparenthesized', 'function f(a,b,c,d,e){return a?b?c:d:e;}'],
    ['emptySwitch', 'switch(1){}'],
    ['switchTerminalSemicolon', 'switch(1){case 1:break;}'],
    ['reservedDotProperty', 'var x={};x.float;'],
    ['reservedObjectKey', 'var x={float:1};'],
    ['strictDirective', '"use strict";var x=1;']
  ];
  const runtimeCases = [
    ['objectDefineGetter', 'typeof Object.prototype.__defineGetter__ === "function"'],
    ['objectDefineProperty', 'typeof Object.defineProperty === "function"'],
    ['objectGetOwnPropertyDescriptor', 'typeof Object.getOwnPropertyDescriptor === "function"'],
    ['objectGetOwnPropertyNames', 'typeof Object.getOwnPropertyNames === "function"'],
    ['functionBind', 'typeof Function.prototype.bind === "function"'],
    ['arrayIsArray', 'typeof Array.isArray === "function"'],
    ['arrayForEach', 'typeof Array.prototype.forEach === "function"'],
    ['objectKeys', 'typeof Object.keys === "function"'],
    ['jsonGlobal', 'typeof JSON !== "undefined"'],
    ['xmlGlobal', 'typeof XML !== "undefined"'],
    ['xmlListGlobal', 'typeof XMLList !== "undefined"'],
    ['illustratorScheduleTask', 'typeof app.scheduleTask === "function"'],
    ['bridgeTalkGlobal', 'typeof BridgeTalk !== "undefined"'],
    ['windowGlobal', 'typeof Window !== "undefined"']
  ];

  const lines = [];
  lines.push('(function(){');
  lines.push('var parseCases=' + JSON.stringify(parseCases) + ';');
  lines.push('var runtimeCases=' + JSON.stringify(runtimeCases) + ';');
  lines.push('var parseBits=[],runtimeBits=[],i;');
  lines.push('for(i=0;i<parseCases.length;i++){try{new Function(parseCases[i][1]);parseBits[parseBits.length]=parseCases[i][0]+"=1";}catch(e){parseBits[parseBits.length]=parseCases[i][0]+"=0";}}');
  lines.push('for(i=0;i<runtimeCases.length;i++){try{var fn=new Function("return ("+runtimeCases[i][1]+");");runtimeBits[runtimeBits.length]=runtimeCases[i][0]+"="+(fn()?1:0);}catch(e2){runtimeBits[runtimeBits.length]=runtimeCases[i][0]+"=0";}}');
  lines.push('return "OK|"+app.version+"|"+$.version+"|parse:"+parseBits.join(",")+"|runtime:"+runtimeBits.join(",");');
  lines.push('}())');

  const result = executeProbe(lines.join('\n'), options);
  if (!result.ok) return result;
  if (!result.raw.startsWith('OK|')) {
    return {
      ok: false,
      raw: result.raw,
      error: 'Illustrator host probe returned an unexpected result.',
      targetId: result.targetId,
      transport: result.transport
    };
  }
  const parts = result.raw.split('|');
  const parse = {};
  const runtime = {};
  for (let i = 3; i < parts.length; i++) {
    const target = parts[i].startsWith('parse:') ? parse :
      (parts[i].startsWith('runtime:') ? runtime : null);
    if (!target) continue;
    const payload = parts[i].slice(parts[i].indexOf(':') + 1);
    if (!payload) continue;
    for (const item of payload.split(',')) {
      const eq = item.lastIndexOf('=');
      if (eq > 0) target[item.slice(0, eq)] = item.slice(eq + 1) === '1';
    }
  }
  return {
    ok: true,
    appVersion: parts[1] || '',
    engineVersion: parts[2] || '',
    generatedAt: new Date().toISOString(),
    launcher: result.transport,
    targetId: result.targetId,
    parse,
    runtime,
    evidence: 'Fixed ESTC feature probe through COM Tool V2. Parser cases use Function constructor; runtime cases evaluate only built-in capability predicates.'
  };
}

export function runReservedProbe(options = {}) {
  const words = [...reservedData.keywords, ...reservedData.futureReserved, ...reservedData.literals];
  const contexts = [
    ['identifier', 'var WORD=1;'],
    ['parameter', 'function f(WORD){return 1;}'],
    ['functionName', 'function WORD(){return 1;}'],
    ['objectKey', 'var x={WORD:1};'],
    ['dotProperty', 'var x={};x.WORD;'],
    ['bracketProperty', 'var x={};x["WORD"];']
  ];
  const lines = [];
  lines.push('(function(){');
  lines.push('var words=' + JSON.stringify(words) + ';');
  lines.push('var defs=' + JSON.stringify(contexts) + ';');
  lines.push('var out=[];');
  lines.push('out.push(app.version);out.push($.version);');
  lines.push('for(var c=0;c<defs.length;c++){var bits="";for(var i=0;i<words.length;i++){');
  lines.push('var src=defs[c][1].replace(/WORD/g,words[i]);try{new Function(src);bits+="1";}catch(e){bits+="0";}}');
  lines.push('out.push(defs[c][0]+":"+bits);}');
  lines.push('return "OK|"+out.join("|");');
  lines.push('}())');

  const result = executeProbe(lines.join('\n'), options);
  if (!result.ok) return result;
  if (!result.raw.startsWith('OK|')) {
    return {
      ok: false,
      raw: result.raw,
      error: 'Illustrator reserved-word probe returned an unexpected result.',
      targetId: result.targetId,
      transport: result.transport
    };
  }
  const parts = result.raw.split('|');
  const appVersion = parts[1] || '';
  const engineVersion = parts[2] || '';
  const matrix = {};
  for (let p = 3; p < parts.length; p++) {
    const idx = parts[p].indexOf(':');
    if (idx < 0) continue;
    const name = parts[p].slice(0, idx);
    const bits = parts[p].slice(idx + 1);
    const row = {};
    for (let i = 0; i < words.length; i++) row[words[i]] = bits[i] === '1';
    matrix[name] = row;
  }
  return {
    ok: true,
    appVersion,
    engineVersion,
    generatedAt: new Date().toISOString(),
    launcher: result.transport,
    targetId: result.targetId,
    words,
    matrix,
    evidence: 'Illustrator Function-constructor parse probe through COM Tool V2; project/document code was not executed.'
  };
}