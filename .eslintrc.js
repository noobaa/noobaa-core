module.exports = {

    // prevent from looking up other config files in containing folders
    root: true,

    // our environment is node.js with it's es6 extensions
    env: {
        node: true,
        es2020: true,
    },

    parserOptions: {
        ecmaVersion: 11, // 2020
    },


    plugins: [
        // eslint-plugin-header validates copyright header
        'header'
    ],

    // RULES METHODOLOGY:
    // -----------------
    // we turn ON all of eslint rules by extending eslint:all
    // we selectively override the rules we want to remove or change.
    // See http://eslint.org/docs/user-guide/configuring#using-eslintall
    extends: 'eslint:all',

    rules: {

        //////////////////////////////////////////////////////////////////////
        //                                                                  //
        // TODO FIX                                                         //
        //                                                                  //
        // Probably best to fix these once we get to it                     //
        //                                                                  //
        //////////////////////////////////////////////////////////////////////

        'require-atomic-updates': 'off',

        //////////////////////////////////////////////////////////////////////
        //                                                                  //
        // ERROR                                                            //
        //                                                                  //
        // The default is error, so these are just for passing options      //
        //                                                                  //
        //////////////////////////////////////////////////////////////////////


        // verify every file contains our copyright header
        'header/header': ['error', 'block', [{
            template: " Copyright (C) 2020 NooBaa ",
            pattern: " Copyright \\(C\\) 20\\d{2} NooBaa ",
        }]],

        // arrow function styling is not a real error but should be consistent
        'arrow-parens': ['error', 'as-needed'],

        'brace-style': ['error', '1tbs', { allowSingleLine: true }],

        // maximum number of code paths in a function
        // TODO eslint complexity should be reduced to ~10 instead of 30
        'complexity': ['error', 35],

        // must use self=this and not any other alternatives
        'consistent-this': ['error', 'self'],

        // allow missing curly braces only for one liners such as if (cond) return;
        'curly': ['error', 'multi-line'],

        // when splitting "obj.property" to 2 lines the dot should stick to the property
        'dot-location': ['error', 'property'],

        // match generator-star-spacing to the beautifier preference
        'generator-star-spacing': 'off',

        // max depth of blocks in a function
        // TODO eslint max-depth of blocks should be reduced to ~3 instead of 5
        'max-depth': ['error', 5],

        // max classed per file
        'max-classes-per-file': 'off',

        // max file length is 300 by default, we accept longer files
        'max-lines': ['error', 2000],

        // max lines per function, default is 50
        'max-lines-per-function': ['error', 400],

        // prefer small number of params to functions, otherwise send object
        // TODO eslint max-params per function should be reduced to ~4 instead of 6
        'max-params': ['error', 7],

        // max statements in function
        // TODO eslint max-statements per function should be reduced to ~40 instead of 60
        'max-statements': ['error', 60],

        'newline-per-chained-call': ['error', { ignoreChainWithDepth: 4 }],

        // don't assign inside a condition, separate the lines for clarity
        'no-cond-assign': ['error', 'always'],

        'no-confusing-arrow': ['error', { allowParens: true }],

        // empty lines are mostly harmless
        'no-multiple-empty-lines': ['error', { max: 20 }],

        // don't allow the code to leave unused variables, this prevents typos in many cases
        'no-unused-vars': ['error', { vars: 'all', args: 'none' }],

        // don't use assignments inside return statements, use separate statements.
        'no-return-assign': ['error', 'always'],

        'no-trailing-spaces': ['error', { ignoreComments: true }],

        // do not allow code using variables before they are defined and initialized,
        // but ok for functions since function decelerations are loaded before the code runs
        'no-use-before-define': ['error', 'nofunc'],

        // break lines after operators, not before
        'operator-linebreak': ['error', 'after'],

        // we prefer single var statement per variable
        'one-var': ['error', 'never'],

        'space-before-function-paren': ['error', {
            'anonymous': 'never',
            'named': 'never',
            'asyncArrow': 'always'
        }],

        'function-call-argument-newline': 'off',

        'space-unary-ops': ['error', {
            words: true,
            nonwords: false,
            overrides: {
                typeof: false,
            },
        }],

        // max line length is 80 by default, allow some slack
        // TODO eslint max-len for code lines should be error and reduced to ~100 instead of 140
        'max-len': ['error', {
            code: 140,
            tabWidth: 4,
            ignoreComments: true,
            ignoreUrls: true,
            ignoreStrings: true,
            ignoreRegExpLiterals: true,
            ignoreTemplateLiterals: true,
        }],

        // warn on using ++ operator, should replace with +=1
        // to avoid shenanigans of the value returned before/after the action
        'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],

        'arrow-body-style': ['error', 'as-needed'],

        // prefer to use function deceleration (function foo() {})
        // instead of expression (foo = function() {})
        'func-style': ['error', 'declaration', { allowArrowFunctions: true }],

        //////////////////////////////////////////////////////////////////////
        //                                                                  //
        // WARN                                                             //
        //                                                                  //
        // These should be a temporary state, as warnings are futile.       //
        // We should eventually decide to change either to error or off.    //
        //                                                                  //
        //////////////////////////////////////////////////////////////////////

        //Hooraay!!! No Warnings

        //////////////////////////////////////////////////////////////////////
        //                                                                  //
        // OFF                                                              //
        //                                                                  //
        // We decided that these rules are too anal for our taste           //
        //                                                                  //
        //////////////////////////////////////////////////////////////////////


        // not forcing how arrays should have new-line breaks
        'array-element-newline': 'off',
        'array-bracket-newline': 'off',
        'array-bracket-spacing': 'off',

        // camelcase is a religion. we were born differently.
        'camelcase': 'off',

        // Example: /=$/ is not like /\=$/ which the eslint expects
        // This is not a relevant rule, we added it after the signature_utils query parsing errors
        'no-div-regex': 'off',

        //not forcing u. as part of a unicode regexp handling
        'require-unicode-regexp': 'off',

        'capitalized-comments': 'off',

        // not enforcing all class methods to use 'this'
        'class-methods-use-this': 'off',

        // dangling commas are great for arrays and object properties
        'comma-dangle': 'off',

        // consistent return does not allow to write promises code very easily
        // because in many cases there are conditions to running a promise,
        // and otherwise the expected behavior is to simply continue.
        'consistent-return': 'off',

        // ending files with single EOL is overrated
        'eol-last': 'off',

        // allowing anonymous functions, used a lot for promises
        'func-names': 'off',

        // not forcing a consistent policy on line breaks inside func parentheses
        'function-paren-newline': 'off',

        // allow short variable names like '_' or 'P' etc. use with care.
        'id-length': 'off',

        'implicit-arrow-linebreak': ['off', 'beside'],

        // indent of 4 spaces would be good to enforce, but it doesn't work well for promise chains
        // so hope no-mixed-spaces-and-tabs will be good enough
        'indent': ['off', 4],

        // not forcing initialization of variables
        'init-declarations': 'off',

        // directive means 'use strict', we don't enforce lines around
        'lines-around-directive': 'off',
        'lines-around-comment': 'off',
        'lines-between-class-members': 'off',

        // we don't enforce comments to above/after the line, both work ok
        'line-comment-position': 'off',

        // ternary operator is better split to 3 lines for readability
        // TODO eslint multiline-ternary should be error
        'multiline-ternary': 'off',

        // use any comment style, just write comments
        'multiline-comment-style': 'off',

        // newlines to separate vars and return are not productive
        'newline-after-var': 'off',
        'newline-before-return': 'off',

        // using console in node.js is cool
        'no-console': 'off',

        // continue in loops is better off avoided for readability
        // prefer to use a function with returns and call from the loop
        // TODO eslint no-continue should be warn/error
        'no-continue': 'off',

        // avoid redundant 'else' when using return statements in all cases
        'no-else-return': 'off',

        'no-extra-parens': ['off', 'all', { nestedBinaryExpressions: false }],

        // short comments in-line are not great but sometimes make a lot of sense
        'no-inline-comments': 'off',

        // we live for magic numbers
        'no-magic-numbers': 'off',

        // prefer to avoid reassigning to function params and use a new variable
        'no-param-reassign': 'off',

        // using process features on nodejs is expected
        'no-process-exit': 'off',
        'no-process-env': 'off',

        // allow usage of sync functions like fs.readFileSync() etc.
        'no-sync': 'off',

        // allowing (x ? y : z) it's a discouraged form but everyone are used to it
        'no-ternary': 'off',

        // using undefined on nodejs is safe. you cannot override it. you can try. it won't work.
        'no-undefined': 'off',

        // we do allow _name or name_ as identifiers
        'no-underscore-dangle': 'off',

        // prefer to use let/const instead of var
        'no-var': 'off',

        // turn off todo/fixme comments - will grep it to a different report
        'no-warning-comments': 'off',

        // the rule object-property-newline is better than object-curly-newline
        'object-property-newline': 'off',
        'object-curly-newline': 'off',

        'object-curly-spacing': 'off',

        // prefer using x={a,b} over x={a:a, b:b} but too much to fix
        'object-shorthand': 'off',

        // ignore stylish padding code blocks with newlines
        'padded-blocks': 'off',

        // prefer using arrow functions for callbacks, but too much to fix
        'prefer-arrow-callback': 'off',

        // prefer using arrow functions for callbacks, but too much to fix
        'prefer-named-capture-group': 'off',

        // we prefer using const, but too much to fix
        'prefer-const': 'off',

        // we prefer using destructuring, but too much to fix
        'prefer-destructuring': 'off',

        'prefer-spread': 'off',
        'prefer-reflect': 'off',
        'prefer-rest-params': 'off',

        // prefer using string template over string concatenation, but too much to fix
        'prefer-template': 'off',

        // prefer using single quotes, but too much to fix
        'quotes': ['off', 'single'],

        'quote-props': 'off',
        'require-jsdoc': 'off',
        'spaced-comment': 'off',
        'sort-keys': 'off',

        // don't verify the structure of jsdoc comments. let them be for now.
        'valid-jsdoc': ['off', { requireReturn: false }],

        // accept var deceleration in mid function, since we already check used before defined
        'vars-on-top': 'off',

        // Allow await in the body of loops.
        'no-await-in-loop': 'off',

        // Allow async function without await, for `return P.map(...)`
        'require-await': 'off',

        'no-promise-executor-return': 'off',

        //Allow spacing between template tags and their literals
        'template-tag-spacing': 'off',
    }
};
