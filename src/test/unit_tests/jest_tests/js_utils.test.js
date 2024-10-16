/* Copyright (C) 2024 NooBaa */
'use strict';

const { sortedLastIndexBy } = require("../../../util/js_utils");

describe('test js_utils.js', () => {
    describe('sortedLastIndexBy', () => {
        it('should correctly find position for number array', () => {
            const test_table = [{
                array: [1, 3, 4, 5],
                target: 0,
                expected_position: 0,
            }, {
                array: [1, 3, 4, 5],
                target: 2,
                expected_position: 1,
            }, {
                array: [1, 3, 4, 5],
                target: 6,
                expected_position: 4,
            }];

            for (const entry of test_table) {
                expect(sortedLastIndexBy(entry.array, curr => curr < entry.target)).toBe(entry.expected_position);
            }
        });

        it('should correctly find position for string array', () => {
            const test_table = [{
                array: ["a", "b", "c", "d"],
                target: "A",
                expected_position: 0,
            }, {
                array: ["a", "b", "d", "e"],
                target: "c",
                expected_position: 2,
            }, {
                array: ["a", "b", "c", "d"],
                target: "z",
                expected_position: 4,
            }];

            for (const entry of test_table) {
                expect(sortedLastIndexBy(entry.array, curr => curr < entry.target)).toBe(entry.expected_position);
            }
        });

        it('should correctly find position for utf8 string (buffer) array', () => {
            // Editors might not render characters in this array properly but that's not a mistake,
            // it's intentional to use such characters - sourced from:
            // https://forum.moonwalkinc.com/t/determining-s3-listing-order/116
            const array = ["file_ꦏ_1.txt", "file__2.txt", "file_￼_3.txt", "file_𐎣_4.txt"];
            const array_of_bufs = array.map(item => Buffer.from(item, 'utf8'));

            const test_table = [{
                array: array_of_bufs,
                target: array_of_bufs[0],
                expected_position: 0,
            }, {
                array: array_of_bufs,
                target: array_of_bufs[2],
                expected_position: 2,
            }, {
                array: array_of_bufs,
                target: array_of_bufs[3],
                expected_position: 3,
            }, {
                array: array_of_bufs,
                target: Buffer.from("file_𐎣_40.txt", 'utf8'),
                expected_position: 4,
            }];

            for (const entry of test_table) {
                expect(sortedLastIndexBy(entry.array, curr => curr.compare(entry.target) === -1)).toBe(entry.expected_position);
            }
        });
    });
});

