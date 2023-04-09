/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

//
// Usage instructions
//
// 1. Enable mongo profiling with:
//  > db.setProfilingLevel(2)
// or
//  > db.setProfilingLevel(1, millis_threshold)
//
// 2. Wait for some profiling data to be collected in db.system.profile
//  > db.system.profile.count()
//
// 3. Run this tool:
//  > mongo nbcore src/tools/mongo_profiler.js
//

const res = {};
db.system.profile.find({
    ns: {
        $ne: 'nbcore.system.profile'
    }
}, {}).forEach(function(p) {
    const col = p.ns.split('.')[1];
    const key = col + '.' + p.op;
    const info = res[key] || { items: [] };
    res[key] = info;
    info.items.push(p);
});

for (const key of Object.keys(res)) {
    const info = res[key];
    const items = info.items;
    items.sort(function(a, b) {
        return a.millis - b.millis;
    });
    const count = items.length;
    const min = info.items[0];
    const med = items[Math.floor(count * 0.5)];
    const p90 = items[Math.floor(count * 0.9)];
    const max = items[count - 1];
    print();
    print('profile:', key);
    print('    count:', count);
    print('    max:', profify(max, '        '));
    print('    p90:', profify(p90, '        '));
    print('    med:', profify(med, '        '));
    print('    min:', profify(min, '        '));
    print();
}

function profify(p, sep) {
    sep = sep || '';
    const max_line = 300;
    let s = '';
    const keys = Object.keys(p);
    const order = ['millis', 'op', 'ns', 'ts', '*', 'locks', 'command', 'query', 'execStats'];
    const omit = ['user', 'allUsers', 'client', 'protocol'];
    keys.sort(function(a, b) {
        const ao = (order.indexOf(a) + 1) || (order.indexOf('*') + 1);
        const bo = (order.indexOf(b) + 1) || (order.indexOf('*') + 1);
        return ao - bo;
    });
    for (const k of keys) {
        if (omit.indexOf(k) >= 0) continue;
        if (k === 'command' && p[k].map) p[k].map = p[k].map.slice(0, p[k].map.indexOf('{'));
        if (k === 'command' && p[k].reduce) p[k].reduce = p[k].reduce.slice(0, p[k].reduce.indexOf('{'));
        let v = JSON.stringify(p[k]) || '';
        if (v.length > max_line) {
            v = v.slice(0, max_line) + ' (truncated)';
        }
        s += '\n' + sep + k + ': ' + v;
    }
    return s;
}
