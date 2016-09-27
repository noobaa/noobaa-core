import ko from 'knockout';
import { noop } from 'utils';

function normalize(handler, name) {
    if (!handler) {
        return noop;
    } else if (!name) {
        return handler;
    } else {
        return function(item, evt) {
            if (evt.animationName === ko.unwrap(name)) {
                return handler.call(this, item, evt);
            } else {
                return true;
            }
        };
    }
}

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let { start, end, name } = valueAccessor();

        return ko.bindingHandlers.event.init(
            element,
            () => ({
                animationstart: normalize(start, name),
                animationend: normalize(end, name)
            }),
            allBindings,
            viewModel,
            bindingContext
        );
    }
};
