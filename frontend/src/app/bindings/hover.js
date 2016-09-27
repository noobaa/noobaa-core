import ko from 'knockout';

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let obs = valueAccessor();
        let count = 0;

        obs(false);
        return ko.bindingHandlers.event.init(
            element,
            () => ({
                mouseenter: () => obs(!!++count),
                mouseleave: () => obs(!!--count)
            }),
            allBindings,
            viewModel,
            bindingContext
        );
    }
};
