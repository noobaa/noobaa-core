/* Copyright (C) 2016 NooBaa */

export default function register(ko) {
    function registerHandler(name, handler) {
        ko.bindingHandlers[name] = handler;
        ko.bindingHandlers[name.toLowerCase()] = handler;
    }

    // Extending existing handlers
    registerHandler('template', require('./template-ex').default);

    // Registering new handlers
    registerHandler('let',              require('./let').default);
    registerHandler('visibility',       require('./visibility').default);
    registerHandler('href',             require('./href').default);
    registerHandler('scroll',           require('./scroll').default);
    registerHandler('canvas',           require('./canvas').default);
    registerHandler('expand',           require('./expand').default);
    registerHandler('tooltip',          require('./tooltip').default);
    registerHandler('scrollTo',         require('./scroll-to').default);
    registerHandler('hover',            require('./hover').default);
    registerHandler('shakeOnClick',     require('./shake-on-click').default);
    registerHandler('childEvent',       require('./child-event').default);
    registerHandler('globalEvent',      require('./global-event').default);
    registerHandler('selection',        require('./selection').default);
    registerHandler('preventBubble',    require('./prevent-bubble').default);
}
