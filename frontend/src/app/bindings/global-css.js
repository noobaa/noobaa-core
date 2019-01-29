/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { noop } from 'utils/core-utils';

const rootElm = global.document.body;

export default {
    init: function(_, ...args) {
        const { init = noop } = ko.bindingHandlers['css'];

        return init(rootElm, ...args);
    },

    update: function(_, ...args) {
        const { update = noop } = ko.bindingHandlers['css'];
        return update(rootElm, ...args);
    }
};
