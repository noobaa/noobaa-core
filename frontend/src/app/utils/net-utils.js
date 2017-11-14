export function splitIPRange(range) {
    const sides = range.split('-');
    const start = sides[0].trim();
    const partialEnd = (sides[1] || '').trim();

    const startParts = start.split('.').map(Number);
    const endParts = partialEnd ? partialEnd.split('.').map(Number) : [];

    const end = [
        ...startParts.slice(0, 4 - endParts.length),
        ...endParts
    ].join('.');

    return { start, end };
}

export function ipToNumber(ip) {
    return ip.split('.')
        .map((part, i) => Math.pow(256, 4  - i) * part)
        .reduce((a, b) => a + b);
}

export function isIP(str) {
    const regExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return regExp.test(str);
}

export function isIPRange(str) {
    if (str.split('-').length !== 2) {
        return false;
    }

    const { start, end } = splitIPRange(str);

    const reason =
        (!isIP(start) && 'MALFORMED') ||
        (!isIP(end) && 'MALFORMED') ||
        (ipToNumber(start) >= ipToNumber(end) && 'INVALID_RANGE_ORDER') ||
        undefined;

    return { valid: !reason, reason };
}

export function isIPOrIPRange(str) {
    if (isIP(str)) {
        return { valid: true };
    } else {
        return !isIPRange(str) ? { valid: false, reason: 'MALFORMED' } : isIPRange(str);
    }
}

export function isDNSName(str) {
    const regExp = /^[A-Za-z0-9][A-Za-z0-9-\.]*[A-Za-z0-9]$/;
    return regExp.test(str);
}

export function isIPOrDNSName(str) {
    return isIP(str) || isDNSName(str);
}

export function isUri(str) {
    const value = str.replace(/^\s+|\s+$/, ''); //Strip whitespace

    //Regex by Diego Perini from: http://mathiasbynens.be/demo/url-regex
    //Modified regex - removed the restrictions for private ip ranges
    const regExp = new RegExp(
        '^' +
            // protocol identifier
            '(?:(?:https?|ftp)://)' +
            // user:pass authentication
            '(?:\\S+(?::\\S*)?@)?' +
            '(?:' +
                  // IP address dotted notation octets
                  // excludes loopback network 0.0.0.0
                  // excludes reserved space >= 224.0.0.0
                  // excludes network & broacast addresses
                  // (first & last IP address of each class)
                  '(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])' +
                  '(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}' +
                  '(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))' +
            '|' +
                  // host name
                  '(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)' +
                  // domain name
                  '(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*' +
                  // TLD identifier
                  '(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))' +
                  // TLD may end with dot
                  '\\.?' +
            ')' +
            // port number
            '(?::\\d{2,5})?' +
            // resource path
            '(?:[/?#]\\S*)?' +
        '$', 'i'
    );

    return regExp.test(value);
}
