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

    let reason;
    const { start, end } = splitIPRange(str);

    if(!isIP(start) || !isIP(end)) {
        reason = 'MALFORMED';
    } else if (ipToNumber(start) >= ipToNumber(end)) {
        reason = 'INVALID_RANGE_ORDER';
    }

    return { valid: !reason, reason };
}

export function isIPOrIPRange(str) {
    let result;

    if(!isIP(str) && !isIPRange(str)) {
        result = { valid: false, reason: 'MALFORMED' };
    } else if(isIP(str)) {
        result = { valid: true };
    } else {
        result = isIPRange(str);
    }

    return result;
}

export function isDNSName(str) {
    const regExp = /^[A-Za-z0-9][A-Za-z0-9-\.]*[A-Za-z0-9]$/;
    return regExp.test(str);
}

export function isIPOrDNSName(str) {
    return isIP(str) || isDNSName(str);
}

