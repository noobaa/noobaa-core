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
    encodeXML: encodeXML
};


function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function encodeXML(instr) {
    return instr.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
 }
