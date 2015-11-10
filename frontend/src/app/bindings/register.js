import letBinding from './let';
import visibilityBinding from './visibility';

export default function register(ko) {
	ko.bindingHandlers.let = letBinding;
	ko.bindingHandlers.visibility = visibilityBinding;
}