import { isFunction, isDefined } from 'utils';

export default function register(ko) {
    Object.assign(ko.validation.rules, {
        // Extend required validator to support expressions.
        required: {
            validator(value, condition) {
                let isRequired = !!(isFunction(condition) ? condition() : condition);

                return isRequired ?
                    isDefined(value) && value !== null && value.length !== 0 :
                    true;
            },

            message: ko.validation.rules.required.message
        },

        isDNSName: {
            validator(value) {
                return /^(?![0-9]+$)(?!-)[a-zA-Z0-9-]{1,63}(?!-)$/.test(value);
            },

            message: 'Please provide a valid DNS name'
        },

        notIn: {
            validator(value, params) {
                params = ko.unwrap(params);
                if (params instanceof Array) {
                  params = { list: params }
                }

                let { list = [], compareFunc = (a,b) => a === b } = params;

                return ko.unwrap(list).every(
                    item => !compareFunc(value, item)
                )
            },

            message: 'Value already exists'
        },

        isURI:{
            validator(val, required) {
                if (!val) {
                  return !required
                }

                val = val.replace(/^\s+|\s+$/, ''); //Strip whitespace
                //Regex by Diego Perini from: http://mathiasbynens.be/demo/url-regex
                //Modified regex - removed the restrictions for private ip ranges
                var re_weburl = new RegExp(
                  "^" +
                    // protocol identifier
                    "(?:(?:https?|ftp)://)" +
                    // user:pass authentication
                    "(?:\\S+(?::\\S*)?@)?" +
                    "(?:" +
                      // IP address dotted notation octets
                      // excludes loopback network 0.0.0.0
                      // excludes reserved space >= 224.0.0.0
                      // excludes network & broacast addresses
                      // (first & last IP address of each class)
                      "(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])" +
                      "(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}" +
                      "(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))" +
                    "|" +
                      // host name
                      "(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)" +
                      // domain name
                      "(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*" +
                      // TLD identifier
                      "(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))" +
                      // TLD may end with dot
                      "\\.?" +
                    ")" +
                    // port number
                    "(?::\\d{2,5})?" +
                    // resource path
                    "(?:[/?#]\\S*)?" +
                  "$", "i"
                );
                return val.match(re_weburl);
            },
              
            message: 'Please enter a valid URI'
        }
    });

    ko.validation.registerExtenders();
}
