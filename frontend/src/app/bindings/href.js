import ko from 'knockout';
import * as routes from 'routes';
import { routeContext } from 'model';
import { realizeUri } from 'utils';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let { route, params } = ko.deepUnwrap(valueAccessor());
        let href = realizeUri(
            routes[route] || '',
            Object.assign({}, routeContext().params, params)
        );

        return ko.bindingHandlers.attr.update(
            element,
            () => href ? { href: encodeURI(href) } : {},
            allBindings,
            viewModel,
            bindingContext
        );
    }
};
