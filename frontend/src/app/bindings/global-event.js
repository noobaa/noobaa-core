import ko from 'knockout';

const { domData } = ko.utils;

function addGlobalListener(event, handler) {
    document.documentElement.addEventListener(event, handler, false);
}

function removeGlobalListener(event, handler) {
    document.documentElement.removeEventListener(event, handler, false);
}

export default {
    init: function(element) {
        // Cleanup registered handlers.
        ko.utils.domNodeDisposal.addDisposeCallback(
            element,
            () => {
                let handlers = domData.get(element, 'globalEvent') || {};
                Object.keys(handlers).forEach(
                    event => removeGlobalListener(event, handlers[event])
                );
            }
        );
    },

    update: function(element, valueAccessor) {
        let handlers = ko.unwrap(valueAccessor()) || {};
        let oldHandlers = domData.get(element, 'globalEvent') || {};

        // Remove old handlers which are not used anymore.
        Object.keys(oldHandlers)
            .filter(
                event => oldHandlers[event] !== handlers[event]
            )
            .forEach(
                event => removeGlobalListener(event, handlers[event])
            );

        // Register new handlers.
        Object.keys(handlers)
            .filter(
                event => handlers[event] !== oldHandlers[event]
            ).forEach(
                event => addGlobalListener(event, handlers[event])
            );

        // Save the new handler map to domData.
        domData.set(element, 'globalEvent', handlers);
    }
};
