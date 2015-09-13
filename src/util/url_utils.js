'use strict';

module.exports = {
    quick_parse: quick_parse,
};

var QUICK_PARSE_REGEXP = /^(\w+\:)(\/\/)?([^\:\/\[\]]+|\[[a-fA-F0-9\:\.]+\])(\:\d+)?(\/[^?#]*)?(\?[^\#]*)?(\#.*)?$/;

/**
 * parse url string faster than url.parse - reduce the time to 1/6
 * this is handy when url parsing is part of incoming request handling and called many times per second.
 * on MacAir url.parse runs 120,000 times per second while consuming 100% cpu,
 * so can be heavy for high RPM server
 */
function quick_parse(url_string) {
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
    return u;
}
