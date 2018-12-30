/* Copyright (C) 2016 NooBaa */

'use strict';
module.exports = [
    {
        display: 'General component',
        generator: require('./component-generator')
    },
    {
        display: 'Modal',
        generator: require('./modal-generator')
    },
    {
        display: 'Reducer',
        generator: require('./reducer-generator')
    }
];
