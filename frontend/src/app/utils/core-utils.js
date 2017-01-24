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

export function isArray(value){
    return value instanceof Array;
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

export function createCompareFunc(accessor, factor = 1) {
    return (a,b) => {
        let key1 = accessor(a);
        let key2 = accessor(b);

        return factor * (
            isArray(key1) ? compareArray(key1, key2) : compare(key1, key2)
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

export function flatMap(arr, predicate) {
    return arr.reduce(
        (result, item) => {
            let mappedValue = predicate(item);

            if (isArray(mappedValue)) {
                result.push(...mappedValue);
            } else {
                result.push(mappedValue);
            }

            return result;
        },
        []
    );
}

export function averageBy(array, predicate) {
    let sum = array
        .map(predicate)
        .reduce(
            (sum, value) => sum + value
        );

    return sum / array.length;
}

export function entries(obj) {
    return Object.keys(obj).map(
        key => [ key, obj[key]]
    );
}

export function keyBy(array, keySelector, valueGenerator = echo) {
    return array.reduce(
        (map, item) => {
            const key = keySelector(item);
            map[key] = valueGenerator(item);
            return map;
        },
        {}
    );
}

export function keyByProperty(array, keyName, valueGenerator) {
    return keyBy(
        array,
        item => item[keyName],
        valueGenerator
    );
}

export function assignWith(target, ...sources) {
    const assignOp = isFunction(last(sources)) ?
        sources.pop() :
        (_, value) => value;

    for (const source of sources) {
        for (const [ key, value ] of entries(source)) {
            target[key] = assignOp(target[key], value);
        }
    }

    return target;
}

export function mapValues(obj, mapOp) {
    const res = {};
    for (const [ key, value ] of entries(obj)) {
        res[key] = mapOp(value, key);
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
