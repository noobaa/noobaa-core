/* Copyright (C) 2023 NooBaa */
/* eslint-disable no-undef */
'use strict';

const string_utils = require('../../../util/string_utils');

describe('string_utils index_of_end', () => {
    it('non existing string', () => {
        const original_string = 'hello world';
        const string_to_search = 'good';
        const res = string_utils.index_of_end(original_string, string_to_search);
        expect(res).toBe(-1); //string_to_search doesn't exist in original_string
    });

    it('existing string', () => {
        const original_string = 'hello world';
        const string_to_search = 'hello';
        const res = string_utils.index_of_end(original_string, string_to_search);
        expect(res).toBe(5); // string_to_search is at the beginning of original_string (indices 0 to 4)
    });

});
