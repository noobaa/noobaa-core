'use strict';

var querystring = require('querystring');

module.exports = {
    quick_parse: quick_parse,
};

var QUICK_PARSE_REGEXP = /^(\w+\:)(\/\/)?([^\:\/\[\]]+|\[[a-fA-F0-9\:\.]+\])(\:\d+)?(\/[^?#]*)?(\?[^\#]*)?(\#.*)?$/;

/**
 * parse url string much faster than url.parse() - reduce the time to 1/10.
 * this is handy when url parsing is part of incoming request handling and called many times per second.
 *
 * on MacAir url.parse() runs ~110,000 times per second while consuming 100% cpu,
 * so url.parse() can be heavy for high RPM server.
 * quick_parse() runs ~1,000,000 times per second.
 * see benchmark() function below.
 *
 */
function quick_parse(url_string, parse_query_string) {
    var match = url_string.match(QUICK_PARSE_REGEXP);
    if (!match) return;
    var u = {
        href: url_string,
        protocol: match[1] || null,
        slashes: match[2] ? true : null,
        hostname: match[3] || '',
        port: match[4] ? parseInt(match[4].slice(1), 10) : null,
        host: (match[3] || '') + (match[4] || ''),
        pathname: match[5] || null,
        search: match[6] || null,
        query: match[6] ? match[6].slice(1) : null,
        path: (match[5] + '') + (match[6] || ''),
        hash: match[7] || null,
        // auth: null,
    };
    if (parse_query_string && u.query) {
        u.query = querystring.parse(u.query);
    }
    return u;
}


function benchmark() {
    var url = require('url');
    var assert = require('assert');
    var testing_url = "http://127.0.0.1:4545/";
    assert(testing_url === url.format(url.parse(testing_url, true)));
    assert(testing_url === url.format(quick_parse(testing_url, true)));
    var tests = [
        function test_url_parse() {
            return url.parse(testing_url, true);
        },
        function test_quick_parse() {
            return quick_parse(testing_url, true);
        }
    ];
    for (var t = 0; t < tests.length; ++t) {
        var test = tests[t];
        console.log(test.name);
        var count = 0;
        var start = Date.now();
        var now = start;
        var last_print = start;
        var last_count = 0;
        var speed;
        do {
            for (var i = 0; i < 5000; ++i) test();
            count += 5000;
            now = Date.now();
            if (now - last_print > 1000) {
                speed = ((count - last_count) * 1000 / (now - last_print)).toFixed(0);
                console.log('\tcurrent times per second:', speed);
                last_print = now;
                last_count = count;
            }
        } while (now - start < 5000);
        speed = (count * 1000 / (now - start)).toFixed(0);
        console.log('\tOVERALL times per second:', speed);
        console.log(' ');
    }
}

if (require.main === module) {
    benchmark();
}
