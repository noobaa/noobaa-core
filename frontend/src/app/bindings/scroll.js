/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { noop } from 'utils/core-utils';

function calcScroll(element) {
    const { scrollTop, scrollHeight, offsetHeight } = element;
    const dist = scrollHeight - offsetHeight;
    return dist ? scrollTop / dist : 1;
}

export default {
    init: function(element, valueAccessor) {
        let pos = valueAccessor();
        if (!ko.isWritableObservable(pos)) {
            pos = ko.pureComputed({ read: pos, write: noop });
        }

        ko.utils.registerEventHandler(
            element,
            'scroll',
            () => { pos(calcScroll(element)); }
        );
    },

    update(element, valueAccessor) {
        const value = ko.unwrap(valueAccessor());
        if (typeof value === 'number') {
            const { scrollHeight, offsetHeight } = element;
            element.scrollTop = (scrollHeight - offsetHeight) * value;
        }
    }
};
