/* Copyright (C) 2016 NooBaa */

export function noop() {
}

export function echo(val) {
    return val;
}

export function deepFreeze(val) {
    if (isObject(val) && !Object.isFrozen(val)) {
        Object.keys(val).forEach(
            key => { val[key] = deepFreeze(val[key]); }
        );
        return Object.freeze(val);
    } else {
        return val;
    }
}

export function deepClone(val) {
    return JSON.parse(JSON.stringify(val));
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

export function isFalsy(value) {
    return !value;
}

export function pick(obj, ...keys) {
    return keys.reduce(
        (picked, key) => {
            if (obj.hasOwnProperty(key)) {
                picked[key] = obj[key];
            }
            return picked;
        },
        {}
    );
}

export function throttle(func, grace, owner) {
    let handle = null;
    return function(...args) {
        clearTimeout(handle);
        handle = setTimeout(() => func.apply(owner || this, args), grace);
    };
}

export function compare(a, b) {
    return a < b ? -1 : (b < a ? 1 : 0);
}

export function compareArray(a, b) {
    for(let i = 0; i < a.length; ++i) {
        let result = compare(a[i], b[i]);
        if (result !== 0) return result;
    }

    return 0;
}

export function createCompareFunc(valueSelector, factor = 1) {
    return (a,b) => {
        let key1 = valueSelector(a);
        let key2 = valueSelector(b);

        return factor * (
            Array.isArray(key1) ? compareArray(key1, key2) : compare(key1, key2)
        );
    };
}

export function makeArray(size, initializer) {
    if (!isFunction(initializer)) {
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

export function first(arr) {
    return arr[0];
}

export function last(arr) {
    return arr[arr.length - 1];
}

export function clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
}

export function bitsToNumber(...bits) {
    return bits.reduce(
        (number, bit) => number << 1 | (!!bit | 0),
        0
    );
}

export function flatMap(arr, predicate = echo) {
    return arr.reduce(
        (result, item) => {
            let mappedValue = predicate(item);

            if (Array.isArray(mappedValue)) {
                result.push(...mappedValue);
            } else {
                result.push(mappedValue);
            }

            return result;
        },
        []
    );
}

export function sumBy(array, selector = echo) {
    return array.map(selector).reduce(
        (sum, value) => sum + value,
        0
    );
}

export function averageBy(array, selector = echo) {
    return sumBy(array, selector) / array.length;
}

export function keyBy(arrayOrIter, keySelector, valueMapper = echo) {
    const array = Array.isArray(arrayOrIter) ?
        arrayOrIter :
        Array.from(arrayOrIter);

    return array.reduce(
        (map, item, i) => {
            const key = keySelector(item, i);
            map[key] = valueMapper(item, map[key]);
            return map;
        },
        {}
    );
}

export function keyByProperty(array, keyName, valueMapper = echo) {
    return keyBy(
        array,
        item => item[keyName],
        valueMapper
    );
}

export function groupBy(array, keySelector, valueMapper = echo) {
    return keyBy(
        array,
        keySelector,
        (item, list = []) => {
            list.push(valueMapper(item));
            return list;
        }
    );
}

export function assignWith(target, ...sources) {
    const assignOp = isFunction(last(sources)) ?
        sources.pop() :
        (_, value) => value;

    for (const source of sources) {
        for (const [ key, value ] of Object.entries(source)) {
            target[key] = assignOp(target[key], value);
        }
    }

    return target;
}

export function mapValues(obj, mapOp, omitUndefinedValues = true) {
    const res = {};
    for (const [ key, value ] of Object.entries(obj)) {
        const newValue = mapOp(value, key);
        if (!omitUndefinedValues || isDefined(newValue)) res[key] = newValue;
    }
    return res;
}

export function interpolateLinear(a, b, t) {
    return a + (b - a) * t;
}

export function decimalRound(number, fractionalLength = 2) {
    const factor = Math.pow(10, fractionalLength);
    return Math.round(number * factor) / factor;
}

export function mergeBy(...arrays) {
    const keySelector = isFunction(last(arrays)) ? arrays.pop() : echo;
    const merge = {};
    for (const arr of arrays) {
        Object.assign(merge, keyBy(arr, keySelector));
    }
    return Object.values(merge);
}

export function runAsync(callback) {
    // TODO: Replace with a postMessage implementation for better results.
    setTimeout(() => callback(), 0);
}

export function reverse(iterable) {
    return Array.from(iterable).reverse();
}

export function get(val, path) {
    for (const part of path) {
        if (isUndefined(val)) break;
        val = val[part];
    }
    return val;
}

export function equalItems(arr1, arr2) {
    return arr1.length === arr2.length &&
        arr1.every((item, i) => Object.is(item, arr2[i]));
}

export function ensureArray(val) {
    return (isString(val) || !isFunction(val[Symbol.iterator])) ? [val] : Array.from(val);
}
