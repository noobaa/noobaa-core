'use strict';

test(10000);
test(100000);
// apparently exactly after 114467 items object delete becomes 600x slower
test(114467);
test(114468);

function test(n) {
    var i;
    var obj = {};
    var map = new Map();
    console.log('Testing', n, 'items ...');
    compare('[set]   ', function() {
        for (i = 0; i < n; ++i) {
            map.set(i, i * 2);
        }
    }, function() {
        for (i = 0; i < n; ++i) {
            obj[i] = i * 2;
        }
    });
    compare('[get]   ', function() {
        var sum = 0;
        for (i = 0; i < n; ++i) {
            sum += map.get(i);
        }
        return sum;
    }, function() {
        var sum = 0;
        for (i = 0; i < n; ++i) {
            sum += obj[i];
        }
        return sum;
    });
    compare('[delete]', function() {
        for (i = 0; i < n; ++i) {
            map.delete(i);
        }
    }, function() {
        for (i = 0; i < n; ++i) {
            delete obj[i];
        }
    });
    console.log('---------------------------------');
}

function compare(name, func1, func2) {
    var time1 = Date.now();
    func1();
    var time2 = Date.now();
    func2();
    var time3 = Date.now();
    console.log(name, 'MAP', (time2 - time1) + 'ms', 'OBJ', (time3 - time2) + 'ms');
}
