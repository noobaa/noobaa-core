module.exports = {

    // extending google's eslint config as base and override rules below
    extends: 'google',

    // our environment is node.js with it's es6 extensions
    env: {
        node: true,
        es6: true
    },

    // Rules legend - 0=off 1=warning 2=error
    // By default all rules are turned off, but we extend google's config
    // which enables many rules, and override with our changes.
    rules: {

        ////////////
        // Errors //
        ////////////

        'eqeqeq': 2,
        'new-cap': 2,
        'curly': [2, 'multi-line'],
        'no-cond-assign': [2, 'always'],
        'no-use-before-define': [2, 'nofunc'],
        'no-unused-vars': [2, {
            'vars': 'all',
            'args': 'none'
        }],
        'space-unary-ops': [2, {
            'words': false,
            'nonwords': false
        }],

        // TODO should be Error once fixed
        'arrow-parens': 1,
        'operator-assignment': 1,
        'no-shadow': 1,
        'no-negated-condition': 1,

        //////////////
        // Warnings //
        //////////////

        'no-useless-constructor': 1,

        // TODO should be Warning once fixed
        'max-len': 0,
        'quotes': [0, 'single'],
        'no-else-return': 0,
        'valid-jsdoc': 0,
        'require-jsdoc': 0,
        'consistent-return': 0,
        'handle-callback-err': 0,

        //////////////////////
        // Off (on purpose) //
        //////////////////////

        'indent': [0, 4],
        'camelcase': 0,
        'comma-dangle': 0,
        'comma-spacing': 0,
        'padded-blocks': 0,
        'spaced-comment': 0,
        'no-console': 0,
        'no-process-exit': 0,
        'no-underscore-dangle': 0,
        'no-constant-condition': 0,
        'no-multiple-empty-lines': 0,
        'eol-last': [0]

    }
};
