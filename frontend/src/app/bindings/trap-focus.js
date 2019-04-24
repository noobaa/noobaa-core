/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { findNextFocusableIn, findPrevFocusableIn } from 'utils/focus-utils';

export default {
    init: function(element, valueAccessor) {
        ko.utils.registerEventHandler(element, 'keydown', evt => {
            // Binding is disabled or not a tab press
            if (!ko.unwrap(valueAccessor()) || (evt.code && evt.code.toLowerCase()) !== 'tab') {
                return;
            }

            evt.preventDefault();
            const { target, shiftKey } = evt;
            const elm = shiftKey ?
                findPrevFocusableIn(element, target, true) :
                findNextFocusableIn(element, target, true);

            // Check that we didn't do a full cycle before focusing.
            if (elm !== target) {
                elm.focus();
            }
        });
    }
};
