import ko from 'knockout';

export default {
    init(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let classList = element.classList;
        let expanded = ko.pureComputed(
            () => ko.unwrap(valueAccessor())
        );

        classList.add('expandable');

        let sub = expanded.subscribe(
            expand => expand ?
                classList.add('expanding') :
                classList.remove('expanding', 'expanded')
        );

        ko.bindingHandlers.event.init(
            element,
            () => ({
                transitionend: () => expanded() && classList.add('expanded')
            }),
            allBindings,
            viewModel,
            bindingContext
        );

        ko.utils.domNodeDisposal.addDisposeCallback(
            element,
            () => sub.dispose()
        );
    }
};
