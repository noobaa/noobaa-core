/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    init: function(element, valueAccessor) {
        let handlers = valueAccessor();
        for (const event of Object.keys(handlers)) {
            ko.utils.registerEventHandler(element, event, handlers[event]);
        }
    }
};
