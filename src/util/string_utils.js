/* Copyright (C) 2016 NooBaa */
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
    left_pad_zeros: left_pad_zeros,
    random_string: random_string
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


function random_string(len = 8) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const chars = [];
    for (let i = 0; i < len; ++i) {
        chars.push(charset.charAt(Math.random() * charset.length | 0));
    }
    return chars.join('');
}
