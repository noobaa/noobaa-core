import ko from 'knockout';

export default {
    init: function(element, valueAccessor) {
        const events = ko.unwrap(valueAccessor());

        (Array.isArray(events) ? events : [events]).forEach(
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
