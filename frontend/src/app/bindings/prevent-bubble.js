/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { ensureArray } from 'utils/core-utils';

export default {
    init: function(element, valueAccessor) {
        ensureArray(ko.unwrap(valueAccessor())).forEach(
            eventName => ko.utils.registerEventHandler(
                element,
                eventName,
                evt => {
                    evt.cancelBubble = true;
                    if (event.stopPropagation) {
                        event.stopPropagation();
                    }
                }
            )
        );
    }
};
