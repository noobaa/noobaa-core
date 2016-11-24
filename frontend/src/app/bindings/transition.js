import ko from 'knockout';
import { noop } from 'utils/all';

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let { start = noop, end = noop } = valueAccessor();

        return ko.bindingHandlers.event.init(
            element,
            () => ({
                transitionstart: start,
                transitionend: end
            }),
            allBindings,
            viewModel,
            bindingContext
        );
    }
};
