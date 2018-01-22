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

export function pick(obj, keys) {
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
    for (let i = 0; i < a.length; ++i) {
        let result = compare(a[i], b[i]);
        if (result !== 0) return result;
    }

    return 0;
}

export function createCompareFunc(valueSelector, factor = 1, ...additionalArgs) {
    return (a,b) => {
        const key1 = valueSelector(a, ...additionalArgs);
        const key2 = valueSelector(b, ...additionalArgs);
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


export const runAsync = (function(env)  {
    if (env.setImmediate) {
        return callback => env.setImmediate(callback);
    }

    if (env.postMessage) {
        const messageKey = 'PROCESS_TICK';
        const queue = [];

        env.addEventListener('message', evt => {
            const { source } = evt;
            if ((source === env || source === null) && evt.data === messageKey) {
                evt.stopPropagation();

                if (queue.length > 0) {
                    const callback = queue.shift();
                    callback();
                }
            }
        }, true);

        return callback => {
            queue.push(callback);
            env.postMessage(messageKey, '*');
        };
    }

    if (env.setTimeout) {
        return callback => { env.setTimeout(callback, 0); };
    }

    throw new Error('No implementation method for run async is available');

})(global);

export function reverse(iterable) {
    return Array.from(iterable).reverse();
}

export function get(val, path, defaultValue) {
    for (const part of path) {
        if (val == null) break;
        val = val[part];
    }

    return isDefined(val) ? val : defaultValue;
}

export function equalItems(arr1, arr2) {
    return arr1.length === arr2.length &&
        arr1.every((item, i) => Object.is(item, arr2[i]));
}

export function ensureArray(val) {
    if ((isString(val) || !isFunction(val[Symbol.iterator]))) {
        return [val];
    }

    if (!Array.isArray(val)) {
        return Array.from(val);
    }

    return val;
}

export function unique(values) {
    return Array.from(new Set(values).values());
}
global.unique = unique;

export function union(...arrays) {
    return unique(flatMap(...arrays));
}

export function hashCode(value) {
    return Array.from(JSON.stringify(value)).reduce(
        (hash, char) => (((hash << 5) - hash) + char.charCodeAt(0)) | 0,
        0
    );
}

export function filterValues(obj, filter) {
    return mapValues(
        obj,
        (value, key) => filter(value, key) ? value : undefined,
        true
    );
}

export function omitUndefined(obj) {
    return mapValues(obj, echo, true);
}

export function normalizeValues(values, newSum = 1, minValue = 0) {
    if (minValue * values.length > newSum) {
        throw new Error('Invalid arguments, sum of min values is greater then new total');
    }

    const minRatio = minValue / newSum;
    const threshold = sumBy(values) * minRatio;
    const belowCount = sumBy(values, value => Number(0 < value && value <= threshold));
    const aboveSum = sumBy(values, value => value > threshold ? value : 0);
    const factor = (1 - belowCount * minRatio) / aboveSum;
    return values.map(value => {
        if (value === 0) return 0;
        return (value <= threshold ? minRatio : value * factor) * newSum;
    });
}
