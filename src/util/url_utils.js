'use strict';

var url = require('url');
var assert = require('assert');
var querystring = require('querystring');

module.exports = {
    quick_parse: quick_parse,
};

var QUICK_PARSE_REGEXP = /^\s*(\w+\:)(\/\/)?(([^\:\/\[\]]+)|\[([a-fA-F0-9\:\.]+)\])(\:\d+)?(\/[^?#]*)?(\?[^\#]*)?(\#.*)?\s*$/;

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
    var u = new url.Url();
    if (!match) return u;
    u.href = url_string;
    u.protocol = match[1] || null;
    u.slashes = match[2] ? true : null;
    u.hostname = match[4] || match[5] || '';
    u.port = match[6] ? parseInt(match[6].slice(1), 10) : null;
    u.host = (match[3] || '') + (match[6] || '');
    u.pathname = match[7] || null;
    u.search = match[8] || null;
    u.query = match[8] ? match[8].slice(1) : null;
    u.path = (match[7] + '') + (match[8] || '');
    u.hash = match[9] || null;
    // u.auth = null;
    if (parse_query_string && u.query) {
        u.query = querystring.parse(u.query);
    } else {
        u.query = {};
    }
    return u;
}


function benchmark() {
    var testing_url = "http://127.0.0.1:4545/";
    var url_parse_res = url.parse(testing_url, true);
    var quick_parse_res = quick_parse(testing_url, true);
    console.log('\nurl.parse(\"' + testing_url + '\") = ', url_parse_res);
    console.log('\nquick_parse(\"' + testing_url + '\") = ', quick_parse_res);
    assert(url.format(url_parse_res) === testing_url);
    assert(url.format(quick_parse_res) === testing_url);
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
        console.log('\nbenchmarking', test.name, '...');
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
    }
    console.log('\ndone.\n');
}

if (require.main === module) {
    benchmark();
}
