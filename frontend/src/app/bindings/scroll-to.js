import ko from 'knockout';

function scroll(element, valueAccessor) {
    let i = ko.unwrap(valueAccessor());
    if ( -1 < i && i < element.children.length) {
        let child = element.children[i];

        element.scrollTop = Math.min(
            child.offsetTop,
            Math.max(
                element.scrollTop,
                child.offsetTop + child.clientHeight - element.clientHeight
            )
        );
    }
}

export default {
    init: scroll,
    update: scroll
};
