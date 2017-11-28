/* Copyright (C) 2016 NooBaa */

import { mapValues } from 'utils/core-utils';
import ko from 'knockout';

const { domData, domNodeDisposal } = ko.utils;
const domDataKey = 'globalEvent';

function addGlobalListener(event, handler) {
    global.addEventListener(event, handler, false);
}

function removeGlobalListener(event, handler) {
    global.removeEventListener(event, handler, false);
}

export default {
    init: function(element) {
        // Cleanup registered handlers.
        domNodeDisposal.addDisposeCallback(
            element,
            () => {
                const handlers = domData.get(element, domDataKey) || {};
                Object.keys(handlers)
                    .forEach(event => removeGlobalListener(event, handlers[event]));
            }
        );
    },

    update: function(element, valueAccessor, allBindings, viewModel) {
        const handlers = mapValues(
            ko.unwrap(valueAccessor()) || {},
            handler => (evt => handler.call(viewModel, viewModel, evt))
        );
        const oldHandlers = domData.get(element, domDataKey) || {};

        // Remove old handlers which are not used anymore.
        Object.keys(oldHandlers)
            .filter(event => oldHandlers[event] !== handlers[event])
            .forEach(event => removeGlobalListener(event, handlers[event]));

        // Register new handlers.
        Object.keys(handlers)
            .filter(event => handlers[event] !== oldHandlers[event])
            .forEach(event => addGlobalListener(event, handlers[event]));

        // Save the new handler map to domData.
        domData.set(element, domDataKey, handlers);
    }
};
