import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveTypesForAdobe } from './typecheck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ADOBE_SAMPLE = path.join(ROOT, 'vendor', 'adobe-cep', 'ExtendScript.d.ts');
const TYPE_SOURCES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-sources.json'), 'utf8'));

function gitBlobSha(bytes) {
  return crypto.createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
    .update(bytes)
    .digest('hex');
}

function addBindingName(name, target, kind) {
  if (!name) return;
  if (ts.isIdentifier(name)) {
    if (!target.has(name.text)) target.set(name.text, new Set());
    target.get(name.text).add(kind);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) addBindingName(element.name, target, kind);
    }
  }
}

function collectDeclarations(sourceFiles) {
  const result = new Map();
  for (const sf of sourceFiles) {
    for (const statement of sf.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        addBindingName(statement.name, result, 'interface');
      } else if (ts.isClassDeclaration(statement)) {
        addBindingName(statement.name, result, 'class');
      } else if (ts.isFunctionDeclaration(statement)) {
        addBindingName(statement.name, result, 'function');
      } else if (ts.isEnumDeclaration(statement)) {
        addBindingName(statement.name, result, 'enum');
      } else if (ts.isTypeAliasDeclaration(statement)) {
        addBindingName(statement.name, result, 'type');
      } else if (ts.isModuleDeclaration(statement)) {
        if (ts.isIdentifier(statement.name)) addBindingName(statement.name, result, 'namespace');
        else if (ts.isStringLiteral(statement.name)) {
          if (!result.has(statement.name.text)) result.set(statement.name.text, new Set());
          result.get(statement.name.text).add('module');
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          addBindingName(declaration.name, result, 'variable');
        }
      }
    }
  }
  return result;
}

function asObject(map) {
  const out = {};
  for (const name of [...map.keys()].sort()) out[name] = [...map.get(name)].sort();
  return out;
}

function programFor(rootNames) {
  return ts.createProgram({
    rootNames,
    options: {
      noEmit: true,
      noLib: true,
      types: [],
      skipLibCheck: true,
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.None
    }
  });
}

export function auditTypeSources(profile = 'Illustrator/2022') {
  const typeEntry = resolveTypesForAdobe(profile);
  const tfaRoot = path.resolve(path.dirname(typeEntry), '..', '..');
  const tfaProgram = programFor([typeEntry]);
  const tfaFiles = tfaProgram.getSourceFiles().filter((sf) => {
    const abs = path.resolve(sf.fileName);
    return abs === tfaRoot || abs.startsWith(tfaRoot + path.sep);
  });

  const adobeProgram = programFor([ADOBE_SAMPLE]);
  const adobeFiles = adobeProgram.getSourceFiles().filter((sf) => path.resolve(sf.fileName) === path.resolve(ADOBE_SAMPLE));

  const tfa = collectDeclarations(tfaFiles);
  const adobe = collectDeclarations(adobeFiles);
  const overlap = [...adobe.keys()].filter((name) => tfa.has(name)).sort();
  const adobeOnly = [...adobe.keys()].filter((name) => !tfa.has(name)).sort();
  const typesForAdobeOnly = [...tfa.keys()].filter((name) => !adobe.has(name)).sort();

  const adobeBytes = fs.readFileSync(ADOBE_SAMPLE);
  const expectedBlobSha = TYPE_SOURCES.adobeSample && TYPE_SOURCES.adobeSample.blobSha
    ? TYPE_SOURCES.adobeSample.blobSha
    : null;
  const actualBlobSha = gitBlobSha(adobeBytes);

  return {
    ok: !expectedBlobSha || expectedBlobSha === actualBlobSha,
    profile,
    primary: {
      name: 'types-for-adobe',
      entry: typeEntry,
      sourceFiles: tfaFiles.length,
      declarationNames: tfa.size
    },
    adobeSample: {
      file: ADOBE_SAMPLE,
      bytes: adobeBytes.length,
      expectedGitBlobSha: expectedBlobSha,
      actualGitBlobSha: actualBlobSha,
      integrity: !expectedBlobSha || expectedBlobSha === actualBlobSha,
      declarationNames: adobe.size
    },
    parity: {
      overlapCount: overlap.length,
      adobeOnlyCount: adobeOnly.length,
      typesForAdobeOnlyCount: typesForAdobeOnly.length,
      overlap,
      adobeOnly,
      typesForAdobeOnly
    },
    declarations: {
      adobeSample: asObject(adobe),
      typesForAdobe: asObject(tfa)
    },
    note: 'Parity is a declaration-name inventory, not a runtime/API-equivalence claim. Types-for-Adobe remains the compile-time baseline; Adobe CEP typings are pinned reference evidence.'
  };
}

export function summarizeTypeAudit(audit) {
  return {
    ok: audit.ok,
    profile: audit.profile,
    typesForAdobeSourceFiles: audit.primary.sourceFiles,
    typesForAdobeDeclarationNames: audit.primary.declarationNames,
    adobeSampleDeclarationNames: audit.adobeSample.declarationNames,
    adobeSampleIntegrity: audit.adobeSample.integrity,
    overlapCount: audit.parity.overlapCount,
    adobeOnlyCount: audit.parity.adobeOnlyCount,
    typesForAdobeOnlyCount: audit.parity.typesForAdobeOnlyCount,
    adobeOnlySample: audit.parity.adobeOnly.slice(0, 12),
    typesForAdobeOnlySample: audit.parity.typesForAdobeOnly.slice(0, 12)
  };
}
