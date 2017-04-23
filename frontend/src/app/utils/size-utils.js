/* Copyright (C) 2016 NooBaa */

import bigInteger from 'big-integer';
import { deepFreeze } from './core-utils';

const unit = 1024;
const bytesInPeta = Math.pow(unit, 5);

export const sizeUnits = deepFreeze([
    ' bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'
]);

export { bigInteger };

// normalize size number or size object to size object.
export function normalizeSize(sizeOrBytes) {
    const { peta = 0, n = sizeOrBytes } = sizeOrBytes;
    return peta !== 0 ? sizeOrBytes : { peta, n };
}

// Compact a size object to nubmer if possible.
export function compactSize(sizeOrBytes) {
    const { peta, n } = normalizeSize(sizeOrBytes);
    return peta === 0 ? n : sizeOrBytes;
}

export function toBigInteger(sizeOrBytes) {
    const { n, peta } = normalizeSize(sizeOrBytes);
    return _toBigInteger(n, peta);
}

export function fromBigInteger(bi) {
    const { quotient, remainder } = bi.divmod(bytesInPeta);
    return compactSize({
        peta: quotient.toJSNumber(),
        n: remainder.toJSNumber()
    });
}


export function mulBigIntegerReal(bi, real){
    const scalar = Math.floor(real);
    const friction = real % 1;

    const { quotient, remainder } = bi.divmod(Number.MAX_SAFE_INTEGER);
    const p1 = Math.floor(quotient * friction);
    const p2 = Math.round(remainder * friction + (quotient % 1) * Number.MAX_SAFE_INTEGER);

    return bigInteger(Number.MAX_SAFE_INTEGER)
        .mul(p1)
        .add(p2)
        .add(bi.mul(scalar));
}

// This function, if passed a size object, will convert the object to a non exact
// integer representation of the size object. A difference may happen for sizes above
// Number.MAX_SAFE_INTEGER because of the inability of floating point numbers to
// represent very big numbers.
export function toBytes(sizeOrBytes){
    const { peta, n } = normalizeSize(sizeOrBytes);
    return peta * bytesInPeta + n;
}

export function interpolateSizes(sizeOrBytes1 = 0, sizeOrBytes2 = 0, t) {
    const bi1 = toBigInteger(sizeOrBytes1);
    const bi2 = toBigInteger(sizeOrBytes2);

    // Interpolates bi1 and bi2 using the the formola bi1 + (bi2 - bi1) * t
    // where 0 <= t <= 1. The interpolation is written using Numbers because bigInteger
    // does not support multiplication with a fraction. The algorithm it guaranteed to
    // work because t is defined as friction between 0 and 1.
    const { quotient, remainder } = bi2.subtract(bi1).divmod(bytesInPeta);
    const peta = Math.floor(quotient * t);
    const n = Math.round(remainder * t + (quotient % 1) * bytesInPeta);
    return fromBigInteger(_toBigInteger(n, peta).add(bi1));
}

export function sumSize(...sizeOrBytesList) {
    return fromBigInteger(
        sizeOrBytesList.reduce(
            (sum, size) => sum.add(toBigInteger(size)),
            bigInteger.zero
        )
    );
}

// Format a size number or size object to human readable string.
export function formatSize(sizeOrBytes) {
    let { peta, n } = normalizeSize(sizeOrBytes);
    let i = 0;

    if (peta > 0) {
        i = 5;
        n = peta + n / bytesInPeta;
    }

    while (n / unit >= 1) {
        n /= unit;
        ++i;
    }

    if (i > 0) {
        n = n.toFixed(n < 10 ? 1 : 0);
    }

    return `${n}${sizeUnits[i]}`;
}

// ----------------------------------
// Internal Helpers
// ----------------------------------
function _toBigInteger(n, peta) {
    return bigInteger(bytesInPeta)
        .multiply(peta)
        .add(n);
}
