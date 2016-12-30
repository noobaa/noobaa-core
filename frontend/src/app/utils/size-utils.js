const unit = 1024;
const petaInBytes = Math.pow(unit, 5);
export const sizeUnits = [' bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];

// This function, if passed a size object, will convert the object to a non exact
// integer representation of the size object. A difference may happen for sizes above
// Number.MAX_SAFE_INTEGER because of the inability of floating point numbers to
// represent very big numbers.
export function sizeToBytes(size){
    const { n = size, peta = 0 } = size;
    return peta * petaInBytes + n;
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
