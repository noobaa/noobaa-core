import ko from 'knockout';
import { domFromHtml } from 'utils';

const original = ko.bindingHandlers.template;

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = valueAccessor();
        if (value.hasOwnProperty('html')) {
            value.nodes = domFromHtml(
                ko.unwrap(value.html)
            );
        }

        if (value.hasOwnProperty('let')) {
            bindingContext = bindingContext.extend(value['let']);
        }

        return original.init(element, () => value, allBindings, viewModel, bindingContext);
    },

    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = valueAccessor();
        if (value.hasOwnProperty('html')) {
            value.nodes = domFromHtml(
                ko.unwrap(value.html)
            );
        }

        if (value.hasOwnProperty('let')) {
            bindingContext = bindingContext.extend(value['let']);
        }

        return original.update(element, () => value, allBindings, viewModel, bindingContext);
    }
};
