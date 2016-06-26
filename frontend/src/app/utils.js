/*global setImmediate */

const sizeUnits = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];

export function noop() {
}

export function invokeAsync(f, ...params) {
    setTimeout(
        () => f(...params),
        0
    );
}

export function isNumber(value) {
    return typeof value === 'number' || value instanceof Number;
}

export function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

export function isFunction(value) {
    return typeof value === 'function';
}

export function isObject(value) {
    return typeof value === 'object' && value !== null;
}

export function isUndefined(value) {
    return typeof value === 'undefined';
}

export function isDefined(value) {
    return !isUndefined(value);
}

export function toCammelCase(str) {
    return str.replace(/-\w/g, match => match[1].toUpperCase());
}

export function toDashedCase(str) {
    return str.replace(/[A-Z]+/g, match => `-${match.toLowerCase()}`);
}

export function formatSize(num) {
    const peta = Math.pow(1024, 5);

    let i = 0;
    if (!isNumber(num)) {
        if (num.peta > 0) {
            i = 5;
            num = num.peta + num.n / peta;
        } else {
            num = num.n;
        }
    }

    while (num / 1024 > 1) {
        num /= 1024;
        ++i;
    }

    if (i > 0) {
        num = num.toFixed(num < 10 ? 1 : 0);
    }

    return `${num} ${sizeUnits[i]}`;
}

export function formatDuration(minutes) {
    let hours = minutes / 60 | 0;
    let days = hours / 24 | 0;
    hours %= 24;
    minutes %= 60;

    return [
        days > 0 ? `${days} day${days > 1 ? 's' : ''}` : null,
        hours > 0 ? `${hours} hour${hours > 1 ? 's' : ''}` : null,
        minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''}` : null
    ]
        .filter(
            part => part
        )
        .reduce(
            (str, part, i, parts) =>
                str + (i === parts.length - 1 ? ' and ' : ', ') + parts
        );
}

export function randomString(len = 8) {
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    return makeArray(
        len,
        () => possible.charAt(Math.random() * possible.length | 0)
    ).join('');
}

export function dblEncode(str) {
    return encodeURIComponent(encodeURIComponent(str));
}

export function parseQueryString(str) {
    return decodeURIComponent(str)
        .replace(/(^\?)/,'')
        .split('&')
        .filter(part => part)
        .reduce( (result, part) => {
            let [name, value] = part.split('=');
            result[toCammelCase(name)] = value || true;
            return result;
        }, {});
}

export function stringifyQueryString(query) {
    return Object.keys(query)
        .reduce((list, key) => {
            if (!isUndefined(query[key])) {
                let encodedName = encodeURIComponent(toDashedCase(key));
                let value = query[key] === true ?
                    encodedName :
                    `${encodedName}=${encodeURIComponent(query[key])}`;

                list.push(value);
            }

            return list;
        }, [])
        .join('&');
}

export function realizeUri(template, params = {}, query = {}) {
    let search = stringifyQueryString(query);
    let base = template
        .split('/')
        .map(
            part => {
                let isParam = part[0] === ':';
                let isOptional = part.substr(-1) === '?';

                if (isParam) {
                    let name = part.substr(1, part.length - 1 - Number(isOptional));
                    let value = params[name ];

                    if (value) {
                        return value;
                    } else if (isOptional) {
                        return null;
                    } else {
                        throw new Error(`Cannot satisfy mandatory parameter: ${name}`);
                    }
                } else {
                    return part;
                }
            }
        )
        .filter(
            part => part !== null
        )
        .map(dblEncode)
        .join('/');

    return search ? `${base}?${search}` : base;
}

export function createCompareFunc(accessor, descending = false) {
    return function (obj1, obj2) {
        let value1 = accessor(obj1);
        let value2 = accessor(obj2);

        return (descending ? -1 : 1) *
            (value1 < value2 ? -1 : (value1 > value2 ? 1 : 0));
    };
}

export function throttle(func, grace, owner) {
    let handle = null;
    return function(...args) {
        clearTimeout(handle);
        handle = setTimeout(() => func.apply(owner || this, args), grace);
    };
}

export function compareStrings(a, b) {
    return a < b ? -1 : ( b < a ? 1 : 0);
}

export function compareInts(a, b) {
    return a - b;
}

export function compareBools(a, b) {
    return b - a;
}

export function equalNoCase(str1, str2) {
    return str1.toLowerCase() === str2.toLowerCase();
}

export function copyTextToClipboard(text) {
    // Prevent XSS attacks.
    let doc = new DOMParser().parseFromString(text, 'text/html');
    text = doc.body.textContent;

    let input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = text;
    input.focus();
    input.select();
    document.execCommand('Copy');
    input.remove();
}

export function downloadFile(url) {
    let body = window.document.body;

    let link = window.document.createElement('a');
    link.download = '';
    link.href = url;
    body.appendChild(link);
    link.click();

    setImmediate(
        () => body.removeChild(link)
    );
}

export function makeArray(size, initializer) {
    if (typeof initializer !== 'function') {
        let val = initializer;
        initializer = () => val;
    }

    let array = [];
    for (let i = 0; i < size; ++i) {
        array.push(initializer(i));
    }
    return array;
}

export function makeRange(start, end) {
    if (isUndefined(end)) {
        if (start < 0) {
            throw new TypeError('Invalid count');
        }

        end = start - 1;
        start = 0;
    }

    let dir = start > end ? -1 : 1;
    let count = Math.abs(end - start + dir);

    return makeArray(
        count,
        i => i * dir + start
    );
}

export function domFromHtml(html) {
    let parser = new DOMParser();
    let doc = parser.parseFromString(html, 'text/html');
    return doc.body.childNodes;
}

export function encodeBase64(obj) {
    return btoa(JSON.stringify(obj));
}

export function last(arr) {
    return arr[arr.length - 1];
}

export function clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
}

export function execInOrder(list, executer) {
    let result = Promise.resolve();

    for (let i = 0; i < list.length; ++i) {
        result = result.then(
            res => res === true || executer(list[i], i)
        );
    }

    return result;
}

export function defineEnum(...values) {
    return Object.freeze(
        values.reduce(
            (enm, val) => {
                enm[val.toString()] = val;
                return val;
            },
            {}
        )
    );
}

export function generateAccessKeys() {
    return {
        access_key: randomString(16),
        secret_key: randomString(32)
    };
}

export function lastSegment(str, delimiter) {
    return str.substr(str.lastIndexOf(delimiter) + 1);
}

export function avgOp(avg, value, i) {
    return avg + (value - avg) / (i + 1);
}

export function shortString(str, maxLength = 25, suffixLengh = 5) {
    if (str.length <= maxLength){
        return str;
    }

    return `${
        str.substr(0, maxLength - (suffixLengh + 3))
    }...${
        str.substr(-suffixLengh)
    }`;
}

export function toOwnKeyValuePair(obj) {
    return Object.keys(obj)
        .map(
            key => ({ key: key, value: obj[key] })
        );
}

export function bitsToNumber(...bits) {
    return bits.reduce(
        (number, bit) => number << 1 | (!!bit | 0),
        0
    );
}

export function pad(num, size, char = '0') {
    return (char.repeat(size) + num).substr(-size);
}

export function deepFreeze(val) {
    if (isObject(val)) {
        Object.keys(val).forEach(
            key => { val[key] = deepFreeze(val[key]); }
        );
        return Object.freeze(val);
    } else {
        return val;
    }
}
