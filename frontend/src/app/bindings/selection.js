/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    init: function(element, valueAccessor) {
        const selection = valueAccessor();

        ['mouseup', 'keyup'].forEach(
            eventName => ko.utils.registerEventHandler(
                element,
                eventName,
                ({ target })=> selection({
                    start: target.selectionStart,
                    end: target.selectionEnd,
                    text: target.value.slice(
                        target.selectionStart, target.selectionEnd
                    )
                })
            )
        );
    }
};
