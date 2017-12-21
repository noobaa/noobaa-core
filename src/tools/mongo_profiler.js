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

var res = {};
db.system.profile.find({
    ns: {
        $ne: 'nbcore.system.profile'
    }
}, {}).forEach(function(p) {
    var col = p.ns.split('.')[1];
    var key = col + '.' + p.op;
    var info = res[key] || { items: [] };
    res[key] = info;
    info.items.push(p);
});

for (var key of Object.keys(res)) {
    var info = res[key];
    var items = info.items;
    items.sort(function(a, b) {
        return a.millis - b.millis;
    });
    var count = items.length;
    var min = info.items[0];
    var med = items[Math.floor(count * 0.5)];
    var p90 = items[Math.floor(count * 0.9)];
    var max = items[count - 1];
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
    var max_line = 300;
    var s = '';
    var keys = Object.keys(p);
    var order = ['millis', 'op', 'ns', 'ts', '*', 'locks', 'command', 'query', 'execStats'];
    var omit = ['user', 'allUsers', 'client', 'protocol'];
    keys.sort(function(a, b) {
        var ao = (order.indexOf(a) + 1) || (order.indexOf('*') + 1);
        var bo = (order.indexOf(b) + 1) || (order.indexOf('*') + 1);
        return ao - bo;
    });
    for (var k of keys) {
        if (omit.indexOf(k) >= 0) continue;
        if (k === 'command' && p[k].map) p[k].map = p[k].map.slice(0, p[k].map.indexOf('{'));
        if (k === 'command' && p[k].reduce) p[k].reduce = p[k].reduce.slice(0, p[k].reduce.indexOf('{'));
        var v = JSON.stringify(p[k]) || '';
        if (v.length > max_line) {
            v = v.slice(0, max_line) + ' (truncated)';
        }
        s += '\n' + sep + k + ': ' + v;
    }
    return s;
}
