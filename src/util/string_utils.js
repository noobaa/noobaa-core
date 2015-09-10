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
    encodeXML: encodeXML,
    toBinary: toBinary
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
 function toBinary (str) {
     var result = '';
     for (var i = 0, l = str.length; i < l; i += 2) {
         result += String.fromCharCode(parseInt(str.substr(i, 2), 16));
     }
     return result;
 }
