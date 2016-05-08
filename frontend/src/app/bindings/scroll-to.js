import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let i = ko.unwrap(valueAccessor());
        if ( -1 < i && i < element.children.length) {
            element.scrollTop = element.children[i].offsetTop;
        }
    }
}