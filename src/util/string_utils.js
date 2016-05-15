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
    toBinary: toBinary
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
