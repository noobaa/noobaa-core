// module targets: nodejs & browserify
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

};


function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}
