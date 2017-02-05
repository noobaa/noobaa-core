/* Copyright (C) 2016 NooBaa */
'use strict';

const eslint = require('eslint');
const minimist = require('minimist');
if (require.main === module) {
    main();
}

function main() {
    const argv = minimist(process.argv);
    const dirs = argv._.slice(2);
    if (!dirs.length) dirs.push('src');
    const include_rules_set = argv.i && new Set(make_array(argv.i));
    const exclude_rules_set = argv.x && new Set(make_array(argv.x));
    const cli = new eslint.CLIEngine();
    const report = cli.executeOnFiles(dirs);
    const rules_array = make_rules_array(report, include_rules_set, exclude_rules_set);
    rules_array.sort(rules_sorting);
    rules_array.forEach(rule => {
        console.log(rule.sev === 2 ? 'ERROR :' : 'warn  :', rule.msgs.length, rule.id);
        if (argv.v) {
            const max = Math.max(Number(argv.v) || 0, 10);
            rule.msgs.slice(0, max).forEach(m => {
                console.log(`\t${m.file.filePath} line ${m.line}`);
            });
            if (rule.msgs.length > max) {
                console.log(`\t... (${rule.msgs.length - max} more similar messages)`);
            }
        }
    });
}

function make_rules_array(report, include_rules_set, exclude_rules_set) {
    const rules_map = new Map();
    report.results.forEach(file => {
        file.messages.forEach(msg => {
            const id = msg.ruleId;
            if (include_rules_set && !include_rules_set.has(id)) return;
            if (exclude_rules_set && exclude_rules_set.has(id)) return;
            const rule = rules_map.get(id) || {
                id: id,
                sev: msg.severity,
                msgs: []
            };
            if (!rule.msgs.length) {
                rules_map.set(id, rule);
            }
            msg.file = file;
            rule.msgs.push(msg);
        });
    });
    const rules_array = Array.from(rules_map.values());
    return rules_array;
}

function rules_sorting(a, b) {
    if (a.sev === b.sev) {
        return a.msgs.length - b.msgs.length;
    }
    return a.sev - b.sev;
}

function make_array(maybe_array) {
    return Array.isArray(maybe_array) ? maybe_array : [maybe_array];
}
