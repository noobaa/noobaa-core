import ko from 'knockout';
import { realizeUri } from 'utils';
import { routeContext } from 'model';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = ko.unwrap(valueAccessor());
        let params = routeContext().params;
        let href = realizeUri(value, params);

        return ko.bindingHandlers.attr.update(
            element, 
            () => (href ? { href } : {}),
            allBindings, 
            viewModel, 
            bindingContext
        );
    }
}
