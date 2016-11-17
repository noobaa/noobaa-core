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
    left_pad_zeros: left_pad_zeros
};


function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function left_pad_zeros(str, to_length) {
    let num_zeros = to_length - str.length;
    let zeros = '';
    if (num_zeros > 0) {
        zeros = '0'.repeat(num_zeros);
    }
    return zeros + str;

}
