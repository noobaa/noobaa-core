import ko from 'knockout';

export default {
    init(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let classList = element.classList;
        let expanded = ko.pureComputed(
            () => ko.unwrap(valueAccessor())
        );

        classList.add('expandable');
        if (expanded()) {
            classList.add('expanded');
            element.style.maxHeight = '1000px';
        }

        let sub = expanded.subscribe(
            expand => {
                if (expand) {
                    classList.add('expanding');
                    element.style.maxHeight = '1000px';
                } else {
                    classList.remove('expanding', 'expanded');
                    element.style.maxHeight = '0px';
                }
            }
        );

        ko.bindingHandlers.event.init(
            element,
            () => ({
                transitionend: () => {
                    expanded() && classList.add('expanded');
                    element.style.maxHeight = `${element.offsetHeight}px`;
                }
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
