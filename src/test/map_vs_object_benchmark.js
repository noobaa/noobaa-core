'use strict';

test(1);
test(10);
test(100);
test(1000);
test(10000);
test(100000);
test(1000000);
test(10000000);

var PREFIX = 'BOOM';

function test(n) {
    var i;
    var obj = {};
    var map = new Map();
    console.log('Testing', n, 'items ...');
    compare('[set]   ', function() {
        for (i = 0; i < n; ++i) {
            map.set(PREFIX + i, i * 2);
        }
    }, function() {
        for (i = 0; i < n; ++i) {
            obj[PREFIX + i] = i * 2;
        }
    });
    compare('[get]   ', function() {
        var sum = 0;
        for (i = 0; i < n; ++i) {
            sum += map.get(PREFIX + i);
        }
        return sum;
    }, function() {
        var sum = 0;
        for (i = 0; i < n; ++i) {
            sum += obj[PREFIX + i];
        }
        return sum;
    });
    compare('[delete]', function() {
        for (i = 0; i < n; ++i) {
            map.delete(PREFIX + i);
        }
    }, function() {
        for (i = 0; i < n; ++i) {
            delete obj[PREFIX + i];
        }
    });
    console.log('---------------------------------');
}

function compare(name, func1, func2) {
    var sum1 = 0;
    var sum2 = 0;
    var count = 0;
    while (sum1 < 100 || sum2 < 100) {
        var time1 = Date.now();
        func1();
        var time2 = Date.now();
        func2();
        var time3 = Date.now();
        sum1 += time2 - time1;
        sum2 += time3 - time2;
        count += 1;
    }
    console.log(name,
        'MAP is x' + (sum2 / sum1).toFixed(1) + ' faster than OBJ',
        '  (' + (sum1 / count).toFixed(6) + ' ms vs. ' + (sum2 / count).toFixed(6) + ' ms)');
}
