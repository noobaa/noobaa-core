/* Copyright (C) 2016 NooBaa */
'use strict';


var PREFIX;

PREFIX = 'BoomBaLoomBa';
console.log('');
console.log('TESTING OBJ WITH PREFIX', PREFIX, '(' + typeof(PREFIX) + ')');
console.log('');
test(1);
test(10);
test(100);
test(1000);
test(10000);
test(100000);
test(1000000);

PREFIX = 0;
console.log('');
console.log('TESTING OBJ ARRAY INDEXES');
console.log('');
test(10000);
test(100000);
test(114467);
test(114468);

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
    while (sum1 < 200 || sum2 < 200) {
        var time1 = Date.now();
        func1();
        var time2 = Date.now();
        func2();
        var time3 = Date.now();
        sum1 += time2 - time1;
        sum2 += time3 - time2;
        count += 1;
    }
    var avg1 = sum1 / count;
    var avg2 = sum2 / count;
    console.log(name,
        'MAP is ' + (100 * (avg2 - avg1) / avg2).toFixed(0) + '% faster than OBJ',
        '  (' + avg1.toFixed(6) + ' ms vs. ' + avg2.toFixed(6) + ' ms)');
}
