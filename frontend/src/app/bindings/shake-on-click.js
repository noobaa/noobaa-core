import ko from 'knockout';

export default {
    init: function(element, valueAccessor) {
        let classList = element.classList;

        ko.utils.registerEventHandler(
            element,
            'click',
            () => ko.unwrap(ko.unwrap(valueAccessor())) && classList.add('shake')
        );

        ko.utils.registerEventHandler(
            element,
            'animationend',
            evt => evt.animationName === 'shake' && classList.remove('shake')
        );
    }
};
