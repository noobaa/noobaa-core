/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const ts = require('typescript');
const util = require('util');
const argv = require('minimist')(process.argv.slice(2));

util.inspect.defaultOptions.depth = 10;
util.inspect.defaultOptions.colors = true;
util.inspect.defaultOptions.breakLength = 100;

const KINDS = {};
for (const [name, num] of Object.entries(ts.SyntaxKind)) {
    KINDS[num] = name;
}
Object.freeze(KINDS);

function main() {
    for (const file_name of argv._) {
        const source_file = ts.createSourceFile(
            file_name,
            fs.readFileSync(file_name, 'utf8'),
            ts.ScriptTarget.ES2018,
        );
        const schema = make_schema(source_file);
        console.log(util.inspect(schema, { depth: null, colors: true }));
    }
}

/**
 * @param {ts.SourceFile} source_file
 */
function make_schema(source_file) {
    const schema = {
        id: source_file.fileName,
        definitions: {},
    };
    source_file.forEachChild(node => {
        switch (node.kind) {
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.InterfaceDeclaration:
                schema.definitions[node.name.text] = make_definition(node);
                break;
            case ts.SyntaxKind.NamespaceExportDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
            case ts.SyntaxKind.ImportDeclaration:
            case ts.SyntaxKind.EndOfFileToken:
                break;
            default:
                console.log(`*** statement: ${KINDS[node.kind]}(${node.kind})`);
                break;
        }
    });
    return schema;
}

/**
 * @param {ts.Node} node
 */
function make_definition(node) {
    const def = {
        type: 'object',
        properties: {},
    };
    add_properties(node, def);
    return def;
}

/**
 * @param {ts.Node} node
 */
function add_properties(node, def) {
    node.forEachChild(m => {
        const key = (m.name && m.name.text) || m.text || '???';
        switch (m.kind) {
            case ts.SyntaxKind.HeritageClause:
                {
                    for (const type of m.types) {
                        console.log(`*** TODO INHERIT ${node.name.text} from ${type.expression.text}`);
                        // add_properties(type.expression, def);
                    }
                    break;
                }
            case ts.SyntaxKind.PropertySignature:
                {
                    const type = m.type.typeName ? m.type.typeName.text : KINDS[m.type.kind];
                    def.properties[key] = { type };
                    break;
                }
            case ts.SyntaxKind.Identifier:
            case ts.SyntaxKind.MethodSignature:
                break;
            default:
                console.log(`*** TODO PROPERTY ${node.name.text}.${key} : ${KINDS[m.kind]}(${m.kind})`);
                break;
        }
    });
}

if (require.main === module) main();
