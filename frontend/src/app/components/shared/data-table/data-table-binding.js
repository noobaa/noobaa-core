import ko from 'knockout';

function setHeadPadding(table) {
    const head = table.querySelector('thead');
    const body = table.querySelector('tbody');

    let diff = head.clientWidth - body.clientWidth;
    head.style.paddingRight = `${diff}px`;
}

ko.bindingHandlers.dataTable = {
    init(element, valueAccessor, allBindings, viewModel, bindingContext) {
        ko.bindingHandlers.event.init(
            window,
            () => ({
                resize: () => setHeadPadding(element)
            }),
            allBindings,
            viewModel,
            bindingContext
        );
    },

    update(element, valueAccessor) {
        ko.unwrap(valueAccessor());
        ko.tasks.schedule(
            () => setHeadPadding(element)
        );
    }
};
