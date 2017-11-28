/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    init: function(element, valueAccessor, allBindings, viewModel) {
        const handlers = valueAccessor() || {};
        for (const [event, handler] of Object.entries(handlers)) {
            const boundHandler = evt => handler.call(viewModel, viewModel, evt);
            ko.utils.registerEventHandler(element, event, boundHandler);
        }
    }
};
