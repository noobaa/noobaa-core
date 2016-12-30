const unit = 1024;
const petaInBytes = Math.pow(unit, 5);
export const sizeUnits = [' bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];

// This function, if passed a size object, will convert the object to a non exact
// integer representation of the size object. A difference may happen for sizes above
// Number.MAX_SAFE_INTEGER because of the inability of floating point numbers to
// represent very big numbers.
export function toBytes(sizeOrBytes){
    const { peta = 0, n = sizeOrBytes } = sizeOrBytes;
    return peta * petaInBytes + n;
}

export function sumSize(...sizeOrBytesList) {
    return sizeOrBytesList
        .map(
            sizeOrBytes => {
                const { peta = 0, n = sizeOrBytes } = sizeOrBytes;
                return { peta, n };
            }
        )
        .reduce(
            (size1, size2) => {
                // The order op operations is important in order to
                // not overflow above one peta.
                const n = -petaInBytes + size1.n + size2.n;
                const peta = size1.peta + size2.peta;
                return {
                    n: n < 0 ? petaInBytes + n : n,
                    peta: peta + Number(n >= 0)
                };
            }
        );
}

// Format a size number or size object to human readable string.
export function formatSize(size) {
    let { n = size, peta = 0 } = size;
    let i = 0;

    if (peta > 0) {
        i = 5;
        n = peta + n / petaInBytes;
    }

    while (n / unit >= 1) {
        n /= unit;
        ++i;
    }

    if (i > 0) {
        n = n.toFixed(size < 10 ? 1 : 0);
    }

    return `${n}${sizeUnits[i]}`;
}
