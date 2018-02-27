/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import {
    findNthNextFocusableIn,
    findNthPrevFocusableIn,
    findFirstFocusableIn,
    findLastFocusableIn
} from 'utils/focus-utils';

const pageJumpSize = 6;

export default {
    init: function(element, valueAccessor) {
        ko.utils.registerEventHandler(element, 'keydown', evt => {
            // Check if the binding is disabled.
            if (!ko.unwrap(valueAccessor())) {
                return;
            }

            const { code, target }  = evt;
            const isInputWithValue =
                target.tagName.toLowerCase() === 'input' &&
                target.value;

            let candidate = null;
            switch (code.toLowerCase()) {
                case 'arrowup': {
                    evt.preventDefault();
                    candidate = findNthPrevFocusableIn(element, target, 1);
                    break;
                }

                case 'arrowdown': {
                    evt.preventDefault();
                    candidate = findNthNextFocusableIn(element, target, 1);
                    break;
                }

                case 'pageup': {
                    evt.preventDefault();
                    candidate = findNthPrevFocusableIn(element, target, pageJumpSize);
                    break;
                }

                case 'pagedown': {
                    evt.preventDefault();
                    candidate = findNthNextFocusableIn(element, target, pageJumpSize);
                    break;
                }

                case 'home': {
                    // Prevent suppress of end key for dropdown filter
                    if (!isInputWithValue) {
                        evt.preventDefault();
                        candidate = findFirstFocusableIn(element);
                    }
                    break;
                }

                case 'end': {
                    // Prevent suppress of end key for dropdown filter
                    if (!isInputWithValue) {
                        evt.preventDefault();
                        candidate = findLastFocusableIn(element);
                    }
                    break;
                }
            }

            if (candidate && candidate !== target) {
                candidate.focus();
            }
        });
    }
};
