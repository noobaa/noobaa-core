/* Copyright (C) 2016 NooBaa */
'use strict';

const js_utils = require('./js_utils');
const { _: CG } = require('ajv');

/**
 * @typedef {import('ajv').KeywordCxt} KeywordCxt
 */

const KEYWORDS = js_utils.deep_freeze({

    methods: {
        keyword: 'methods',
    },

    doc: {
        keyword: 'doc',
    },

    // schema: { date: true } will match (new Date())
    date: {
        keyword: 'date',
        errors: false,
        // schemaType: 'boolean',
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            const d = cxt.it.data;
            cxt.pass(CG ` ${d} instanceof Date `);
        }
    },

    // schema: { idate: true } will match (new Date()).getTime()
    idate: {
        keyword: 'idate',
        // schemaType: 'boolean',
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            // TODO: Remove accepting instanceof Date after converting all uses of
            // idates in the database schema into the date format (currently most of them are
            // already saved in ISO format which is not idate)
            const d = cxt.it.data;
            cxt.gen
                .if(CG `
                    Number.isInteger(${d}) &&
                    Number.isInteger(new Date(${d}).getTime())
                `) // good idate
                .elseIf(CG ` ${d} instanceof Date `) // ok but see todo ^
                .else()
                .code(() => cxt.error())
                .endIf();
        }
    },

    // schema: { objectid: true } will match (new mongodb.ObjectId()) or (new mongodb.ObjectId()).valueOf()
    objectid: {
        keyword: 'objectid',
        // schemaType: 'boolean',
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            const d = cxt.it.data;
            cxt.gen
                .if(CG `
                    typeof ${d} === 'object' &&
                    ${d} && 
                    ${d}.constructor && 
                    ${d}.constructor.name === 'ObjectID'
                `)
                .elseIf(CG `
                    typeof ${d} === 'string' &&
                    /^[0-9a-fA-F]{24}$/.test(${d})
                `)
                .else()
                .code(() => cxt.error())
                .endIf();
        }
    },

    // schema: { binary: 64 } will match Buffer.alloc(64)
    // schema: { binary: true } will match Buffer.alloc(<any>)
    binary: {
        keyword: 'binary',
        // schemaType: ['boolean', 'number'],
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            const d = cxt.data;
            const s = cxt.schemaValue;
            cxt.gen
                .if(CG `
                    Buffer.isBuffer(${d}) && (
                        typeof ${s} === 'number' ? 
                        ${d}.length === ${s} :
                        ${s}
                    )
                `)
                .elseIf(CG `
                    ${d}._bsontype === 'Binary' && (
                        typeof ${s} === 'number' ? 
                        ${d}.length() === ${s} :
                        ${s}
                    )
                `)
                .else()
                .code(() => cxt.error())
                .endIf();
        }
    },

    wrapper: {
        keyword: 'wrapper',
        errors: false,
        modifying: true,
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            if (cxt.it.dataLevel <= 0) throw new Error('wrapper should not be in the root of the schema');
            const d = cxt.data;
            const s = cxt.schemaValue;
            const p = cxt.it.parentData;
            const pp = cxt.it.parentDataProperty;
            cxt.gen
                .if(CG ` ${d} instanceof ${s} `)
                .elseIf(CG ` ${s}.can_wrap(${d}) `)
                .assign(CG ` ${p}[${pp}] `, CG ` new ${s}(${d}) `)
                .else()
                .code(() => cxt.error())
                .endIf();
        }
    },

    wrapper_check_only: {
        keyword: 'wrapper',
        errors: false,
        /**
         * 
         * @param {KeywordCxt} cxt 
         * 
         */
        code(cxt) {
            if (cxt.it.dataLevel <= 0) return;
            const d = cxt.data;
            const s = cxt.schemaValue;
            cxt.pass(CG `
                ${d} instanceof ${s} ||
                ${s}.can_wrap(${d})
            `);
        }
    }

});

exports.KEYWORDS = KEYWORDS;
