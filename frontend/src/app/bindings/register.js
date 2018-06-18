/* Copyright (C) 2016 NooBaa */

export default function register(ko) {
    function registerHandler(name, handler) {
        ko.bindingHandlers[name] = handler;
        ko.bindingHandlers[name.toLowerCase()] = handler;

        if (handler.allowOnVirtualElements) {
            ko.virtualElements.allowedBindings[name] = true;
            ko.virtualElements.allowedBindings[name.toLowerCase()] = true;
        }
    }

    // Extending existing handlers
    registerHandler('template', require('./template-ex').default);
    registerHandler('value', require('./value-ex').default);

    // Registering new handlers
    registerHandler('let',                  require('./let').default);
    registerHandler('visibility',           require('./visibility').default);
    registerHandler('href',                 require('./href').default);
    registerHandler('scroll',               require('./scroll').default);
    registerHandler('canvas',               require('./canvas').default);
    registerHandler('expand',               require('./expand').default);
    registerHandler('tooltip',              require('./tooltip').default);
    registerHandler('scrollTo',             require('./scroll-to').default);
    registerHandler('scrollToIf',             require('./scroll-to-if').default);
    registerHandler('hover',                require('./hover').default);
    registerHandler('shakeOnClick',         require('./shake-on-click').default);
    registerHandler('childEvent',           require('./child-event').default);
    registerHandler('globalEvent',          require('./global-event').default);
    registerHandler('selection',            require('./selection').default);
    registerHandler('preventBubble',        require('./prevent-bubble').default);
    registerHandler('validationCss',        require('./validation-css').default);
    registerHandler('bubbleEvents',         require('./bubble-events').default);
    registerHandler('trapFocus',            require('./trap-focus').default);
    registerHandler('keysToClicks',         require('./keys-to-clicks').default);
    registerHandler('keyboardNavigation',   require('./keyboard-navigation').default);
    registerHandler('hidden',               require('./hidden').default);
}
