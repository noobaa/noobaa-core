'use strict';

/**
 *
 * string_utils
 *
 * various string utils
 *
 */
module.exports = {
    escapeRegExp: escapeRegExp,
    toBinary: toBinary,
    left_pad_zeros: left_pad_zeros
};


function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function toBinary(str) {
    var result = '';
    for (var i = 0, l = str.length; i < l; i += 2) {
        result += String.fromCharCode(parseInt(str.substr(i, 2), 16));
    }
    return result;
}

function left_pad_zeros(str, to_length) {
    let num_zeros = to_length - str.length;
    let zeros = '';
    if (num_zeros > 0) {
        zeros = '0'.repeat(num_zeros);
    }
    return zeros + str;

}
