/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    init: function(element, valueAccessor) {
        const keys = ko.pureComputed(() => {
            const keys = ko.unwrap(valueAccessor());
            if (!Array.isArray(keys)) {
                throw new Error('Invlid value, must be an array of key codes');
            }

            return keys.map(key => key
                .toString()
                .toLowerCase()
            );
        });

        ko.utils.registerEventHandler(element, 'keydown', evt => {
            if (!keys().includes(evt.code.toLowerCase())) {
                return;
            }

            evt.preventDefault();
            element.click();
        });
    }
};
