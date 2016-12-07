export default function register(ko) {
    // Extending existing handlers
    ko.bindingHandlers.template        = require('./template-ex').default;

    // Registering new handlers
    ko.bindingHandlers.let          = require('./let').default;
    ko.bindingHandlers.visibility   = require('./visibility').default;
    ko.bindingHandlers.href         = require('./href').default;
    ko.bindingHandlers.scroll       = require('./scroll').default;
    ko.bindingHandlers.canvas       = require('./canvas').default;
    ko.bindingHandlers.transition   = require('./transition').default;
    ko.bindingHandlers.animation    = require('./animation').default;
    ko.bindingHandlers.expand       = require('./expand').default;
    ko.bindingHandlers.tooltip      = require('./tooltip').default;
    ko.bindingHandlers.scrollTo     = require('./scroll-to').default;
    ko.bindingHandlers.hover        = require('./hover').default;
    ko.bindingHandlers.shakeOnClick = require('./shake-on-click').default;
    ko.bindingHandlers.childEvent   = require('./child-event').default;
    ko.bindingHandlers.globalEvent  = require('./global-event').default;
}
