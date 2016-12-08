/*global setImmediate */
import ko from 'knockout';

export default {
    init(element, valueAccessor, allBindings, viewModel, bindingContext) {
        const classList = element.classList;
        let expanded = ko.pureComputed(
            () => ko.unwrap(valueAccessor())
        );

        classList.add('expandable');
        if (expanded()) {
            classList.add('expanded');
        } else {
            element.style.maxHeight = '0px';
        }

        let sub = expanded.subscribe(
            expand => {
                const { style } = element;
                if (expand) {
                    classList.add('expanding');

                    style.removeProperty('max-height');
                    let height = element.offsetHeight;
                    style.maxHeight = '0px';
                    setImmediate(
                        () => { style.maxHeight = `${height}px`; }
                    );

                } else {
                    style.maxHeight = `${element.offsetHeight}px`;
                    setImmediate(
                        () => {
                            style.maxHeight = '0px';
                        }
                    );

                    classList.remove('expanding', 'expanded');
                }
            }
        );

        ko.bindingHandlers.event.init(
            element,
            () => ({
                transitionend: () => {
                    if (expanded()) {
                        classList.add('expanded');
                        element.style.removeProperty('max-height');
                    }
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
