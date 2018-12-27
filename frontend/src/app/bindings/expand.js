/* Copyright (C) 2016 NooBaa */

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
            const { style } = element;
            style.maxHeight = '0px';
            style.display = 'none';
        }

        let sub = expanded.subscribe(
            expand => requestAnimationFrame(() => {
                const { style } = element;
                if (expand) {
                    classList.add('expanding');
                    style.removeProperty('display');
                    style.removeProperty('max-height');
                    let height = element.offsetHeight;
                    style.maxHeight = '0px';
                    requestAnimationFrame(() => { style.maxHeight = `${height}px`; });

                } else {
                    style.maxHeight = `${element.offsetHeight}px`;
                    classList.remove('expanding', 'expanded');
                    requestAnimationFrame(() => { style.maxHeight = '0px'; });
                }
            })
        );

        ko.bindingHandlers.event.init(
            element,
            () => ({
                transitionend: () => {
                    if (expanded()) {
                        classList.add('expanded');
                        element.style.removeProperty('max-height');
                    } else {
                        element.style.display = 'none';
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
